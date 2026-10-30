// The one player of the shadowing screen. Every control goes through it, so
// the article and single passages share one audio element and never overlap.
// It is plain TypeScript so its rules can be tested without React or a browser.

import type { Clip, SegmentUnit } from "./passageSegments";

/** How long the learner gets to repeat what they heard aloud before the audio goes on. */
export type RepeatPause = "none" | "twoSeconds" | "threeSeconds" | "fiveSeconds" | "clipLength";

/** How passages are played: whole, or a sentence or phrase at a time. */
export type RepeatUnit = "passage" | SegmentUnit;

/**
 * - `idle`: nothing has been played yet.
 * - `article`: every passage in lesson order.
 * - `passage`: one passage on its own.
 *
 * Both play by the chosen `unit`, with `repeatPause` for repeating each part aloud.
 * With the defaults, the article plays straight through for reading along.
 */
export type ShadowingMode = "idle" | "article" | "passage";

/**
 * Where the current passage is:
 * - `loading`: its audio is being fetched, or generated first;
 * - `audio`: its audio is playing, or paused;
 * - `yourTurn`: the pause after a part of the article, a sentence, phrase or looping passage, for the learner to repeat it aloud;
 * - `ended`: stopped at the end of the passage, or of the article;
 * - `failed`: its audio could not be loaded or played (see `error`).
 */
export type ShadowingPhase = "loading" | "audio" | "yourTurn" | "ended" | "failed";

export interface ShadowingState {
  mode: ShadowingMode;
  /** The passage in the player; meaningless while `mode` is idle. */
  index: number;
  /**
   * The sentence or phrase playing, or the one that plays next once stopped.
   * Always 0 for a whole passage.
   */
  segment: number;
  phase: ShadowingPhase;
  /** The learner paused; resuming continues the audio or the countdown. */
  isPaused: boolean;
  /** Play the same passage, sentence or phrase again after the learner's turn. */
  isPassageLooping: boolean;
  /** Start the article over after its last passage. */
  isArticleLooping: boolean;
  /** For single passages and the article alike, as are `repeatPause` and `unit`. */
  speed: number;
  repeatPause: RepeatPause;
  unit: RepeatUnit;
  /** Seconds into the current passage. */
  currentTime: number;
  /** Length in seconds of the current passage's audio; 0 until known. */
  duration: number;
  /** Countdown of the learner's turn. */
  turnRemainingMs: number;
  turnTotalMs: number;
  error: string | null;
}

/** The parts of an HTMLAudioElement the player uses; tests pass a fake. */
export interface AudioOutput {
  src: string;
  currentTime: number;
  readonly duration: number;
  readonly ended: boolean;
  playbackRate: number;
  defaultPlaybackRate: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(
    type: "ended" | "loadedmetadata" | "durationchange" | "error",
    listener: () => void,
  ): void;
}

/** The clock and timers; tests control them. */
export interface Timers {
  now(): number;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface ShadowingPlayerOptions {
  audio: AudioOutput;
  timers: Timers;
  passageCount: number;
  /** Resolves a passage's audio to a playable URL, generating it first when needed. */
  passageUrl: (index: number) => Promise<string>;
  /** Where each sentence or phrase of a passage is in its audio, in order. */
  passageClips: (index: number, unit: SegmentUnit) => Promise<Clip[]>;
}

const STOPPED = {
  mode: "idle",
  index: 0,
  segment: 0,
  phase: "ended",
  isPaused: false,
  isPassageLooping: false,
  currentTime: 0,
  duration: 0,
  turnRemainingMs: 0,
  turnTotalMs: 0,
  error: null,
} as const satisfies Partial<ShadowingState>;

const INITIAL_STATE: ShadowingState = {
  ...STOPPED,
  isArticleLooping: false,
  speed: 1,
  repeatPause: "none",
  unit: "passage",
};

/** A whole passage is one clip, which ends where its audio does. */
const WHOLE_PASSAGE: readonly Clip[] = [{ start: 0, end: Infinity }];

/** A clip timer that fires this close to the clip's end has reached it. */
const CLIP_END_SLACK_SECONDS = 0.02;

/** Audio is playing or about to, or the learner's turn is counting down. */
export function isRunning(state: ShadowingState): boolean {
  if (state.mode === "idle" || state.isPaused) return false;
  return state.phase === "loading" || state.phase === "audio" || state.phase === "yourTurn";
}

/** The learner's turn after hearing a clip that lasts `clipSeconds` at speed 1. */
export function repeatPauseMs(pause: RepeatPause, clipSeconds: number, speed: number): number {
  switch (pause) {
    case "none":
      return 0;
    case "twoSeconds":
      return 2000;
    case "threeSeconds":
      return 3000;
    case "fiveSeconds":
      return 5000;
    case "clipLength":
      return (clipSeconds / speed) * 1000;
  }
}

export class ShadowingPlayer {
  private readonly audio: AudioOutput;
  private readonly timers: Timers;
  private readonly passageCount: number;
  private readonly passageUrl: (index: number) => Promise<string>;
  private readonly passageClips: (index: number, unit: SegmentUnit) => Promise<Clip[]>;
  private readonly listeners = new Set<() => void>();
  private current: ShadowingState = INITIAL_STATE;
  /** The passage whose audio is in `audio.src`; -1 while none is, or while it is being replaced. */
  private loadedIndex = -1;
  /** Bumped by every load, so that a slow load that was overtaken is ignored. */
  private loadId = 0;
  /** Sentences and phrases already found, by `clipsKey`. */
  private readonly knownClips = new Map<string, readonly Clip[]>();
  private turnTimer: number | null = null;
  private turnEndsAt = 0;
  /** Stops the audio at the end of a sentence or phrase. */
  private clipTimer: number | null = null;

  constructor(options: ShadowingPlayerOptions) {
    this.audio = options.audio;
    this.timers = options.timers;
    this.passageCount = options.passageCount;
    this.passageUrl = options.passageUrl;
    this.passageClips = options.passageClips;
    this.applySpeed(this.current.speed);
    this.audio.addEventListener("ended", () => this.onEnded());
    this.audio.addEventListener("loadedmetadata", () => this.onDuration());
    this.audio.addEventListener("durationchange", () => this.onDuration());
    this.audio.addEventListener("error", () => this.onAudioError());
  }

  // For useSyncExternalStore: a new state object after every change.
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): ShadowingState => this.current;

  // -- The article ----------------------------------------------------------

  /** Pauses and resumes the article; from passage practice, or once finished, it starts over. */
  toggleArticle() {
    if (this.isArticleGoing()) this.togglePause();
    else this.restartArticle();
  }

  restartArticle() {
    this.start("article", 0);
  }

  setArticleLooping(isArticleLooping: boolean) {
    this.update({ isArticleLooping });
  }

  // -- Single passages ------------------------------------------------------

  /**
   * Plays or pauses the passage in the player. Any other passage plays on its
   * own, leaving the article if it was running. Once stopped, it goes on from
   * the sentence or phrase where it stopped, or starts over after the end of
   * the passage.
   */
  togglePassage(index: number) {
    const s = this.current;
    if (!this.isInPlayer(index)) this.start("passage", index);
    else if (s.phase === "ended") this.playSegment(index, s.segment);
    else this.togglePause();
  }

  /**
   * Whether playback carries on after this passage, by being the article from
   * here on. Audio already playing is not interrupted; a passage that has
   * ended goes on to the next one.
   */
  togglePassageContinue(index: number) {
    const s = this.current;
    if (!this.isInPlayer(index)) {
      this.start("article", index);
    } else if (s.phase === "ended") {
      this.advanceArticle();
    } else if (s.mode === "passage") {
      this.update({ mode: "article" });
    } else {
      this.update({ mode: "passage" });
      if (s.phase === "yourTurn" && !s.isPassageLooping && !this.hasNextSegment()) this.stopTurn();
    }
  }

  /** Plays the current sentence or phrase (or the whole passage) again from its beginning. */
  replayPassage(index: number) {
    this.playSegment(index, this.isInPlayer(index) ? this.current.segment : 0);
  }

  /** Plays one sentence or phrase of a passage, and goes on from there. */
  playSegment(index: number, segment: number) {
    const isPassageLooping = this.isInPlayer(index) && this.current.isPassageLooping;
    this.start(this.controlsMode(), index, { segment, isPassageLooping });
  }

  togglePassageLoop(index: number) {
    const s = this.current;
    if (!this.isInPlayer(index)) {
      this.start(this.controlsMode(), index, { isPassageLooping: true });
    } else if (!s.isPassageLooping && s.phase === "ended") {
      this.start("passage", index, { segment: s.segment, isPassageLooping: true });
    } else if (s.isPassageLooping && s.phase === "yourTurn" && !this.goesOnAfterClip()) {
      this.stopTurn();
    } else {
      this.update({ isPassageLooping: !s.isPassageLooping });
    }
  }

  setRepeatPause(repeatPause: RepeatPause) {
    this.update({ repeatPause });
  }

  /** The sentences or phrases change: passage practice stops, and the article starts its passage over. */
  setUnit(unit: RepeatUnit) {
    if (this.current.mode === "passage") {
      this.clearTimers();
      this.loadId++;
      this.audio.pause();
      this.update({ ...STOPPED, unit });
      return;
    }
    this.update({ unit });
    if (this.isArticleGoing()) this.start("article", this.current.index);
  }

  // -- Either mode ----------------------------------------------------------

  /**
   * Moves within the passage in the player, to the sentence or phrase at that
   * point. From the learner's turn it goes back to the audio.
   */
  seek(seconds: number) {
    const s = this.current;
    if (this.loadedIndex !== s.index || s.phase === "loading" || s.phase === "failed") return;
    this.clearTimers();
    const currentTime = Math.min(Math.max(seconds, 0), s.duration);
    this.audio.currentTime = currentTime;
    const startedClips = this.clips().filter((clip) => clip.start <= currentTime);
    const segment = Math.max(0, startedClips.length - 1);
    const isPaused = s.isPaused || s.phase === "ended";
    this.update({ phase: "audio", segment, currentTime, isPaused, turnRemainingMs: 0, turnTotalMs: 0 });
    if (isPaused) return;
    if (s.phase === "audio") this.watchClipEnd();
    else this.play();
  }

  /** Loads the failed passage again and plays it. */
  retry() {
    const s = this.current;
    if (s.phase !== "failed" || s.mode === "idle") return;
    this.start(s.mode, s.index, { segment: s.segment, isPassageLooping: s.isPassageLooping });
  }

  setSpeed(speed: number) {
    this.applySpeed(speed);
    this.update({ speed });
    // The rest of the clip now takes a different time.
    if (this.clipTimer !== null) this.watchClipEnd();
  }

  /** Samples the clock while audio plays or the learner's turn counts down. */
  sample() {
    const s = this.current;
    if (s.isPaused) return;
    if (s.phase === "audio" && this.loadedIndex === s.index) {
      const currentTime = this.audio.currentTime;
      if (currentTime !== s.currentTime) this.update({ currentTime });
    } else if (s.phase === "yourTurn") {
      const turnRemainingMs = this.turnRemaining();
      if (turnRemainingMs !== s.turnRemainingMs) this.update({ turnRemainingMs });
    }
  }

  /** Stops playback and cancels the countdown and any pending load, as when leaving the screen. */
  stop() {
    this.clearTimers();
    this.loadId++;
    this.loadedIndex = -1;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.update(STOPPED);
  }

  // -- Internals ------------------------------------------------------------

  private isInPlayer(index: number): boolean {
    return this.current.mode !== "idle" && this.current.index === index;
  }

  private isArticleGoing(): boolean {
    return this.current.mode === "article" && this.current.phase !== "ended";
  }

  /** A passage's controls keep a running article going from wherever they point. */
  private controlsMode(): "article" | "passage" {
    return this.isArticleGoing() ? "article" : "passage";
  }

  /**
   * Makes `index` the current passage in `mode` and plays it from the start
   * of `segment`. Whatever was playing or counting down stops first.
   */
  private start(
    mode: "article" | "passage",
    index: number,
    { segment = 0, isPassageLooping = false } = {},
  ) {
    this.clearTimers();
    const loadId = ++this.loadId;
    const { unit } = this.current;
    const unitToFind = unit !== "passage" && !this.knownClips.has(clipsKey(index, unit)) ? unit : null;
    const hasAudio = this.loadedIndex === index;
    const isReady = hasAudio && unitToFind === null;
    this.update({
      mode,
      index,
      segment,
      isPaused: false,
      isPassageLooping,
      phase: isReady ? "audio" : "loading",
      currentTime: 0,
      duration: hasAudio ? this.current.duration : 0,
      turnRemainingMs: 0,
      turnTotalMs: 0,
      error: null,
    });

    if (isReady) {
      this.cue(segment);
      this.play();
      return;
    }

    this.audio.pause();
    if (!hasAudio) this.loadedIndex = -1;
    Promise.all([
      hasAudio ? null : this.passageUrl(index),
      unitToFind ? this.passageClips(index, unitToFind) : null,
    ]).then(
      ([url, clips]) => {
        if (loadId !== this.loadId) return;
        // Without clips it plays whole this time, and tries again next time.
        if (unitToFind && clips?.length) this.knownClips.set(clipsKey(index, unitToFind), clips);
        this.loaded(index, url);
      },
      (error: unknown) => {
        if (loadId !== this.loadId) return;
        const reason = error instanceof Error ? error.message : String(error);
        this.fail(`The audio of passage ${index + 1} could not be loaded: ${reason}`);
      },
    );
  }

  /** `url` is null when the passage's audio was in the player already. */
  private loaded(index: number, url: string | null) {
    if (url !== null) {
      this.loadedIndex = index;
      this.audio.src = url;
    }
    this.cue(this.current.segment);
    // The learner may have paused while it was loading.
    if (!this.current.isPaused) this.play();
    this.preloadAfter(index);
  }

  /** Fetches (or generates) the passage the article plays next, so it starts without a wait. */
  private preloadAfter(index: number) {
    const s = this.current;
    if (s.mode !== "article") return;
    const next = index + 1 < this.passageCount ? index + 1 : s.isArticleLooping ? 0 : index;
    // A failure shows up, with a retry, once the article reaches that passage.
    if (next !== index) this.passageUrl(next).catch(() => undefined);
  }

  /** The clips of the passage in the player: its sentences or phrases, or the whole of it. */
  private clips(): readonly Clip[] {
    const { mode, index, unit } = this.current;
    if (mode === "idle" || unit === "passage") return WHOLE_PASSAGE;
    return this.knownClips.get(clipsKey(index, unit)) ?? WHOLE_PASSAGE;
  }

  private hasNextSegment(): boolean {
    return this.current.segment + 1 < this.clips().length;
  }

  /** The article gives a turn after every clip, even its last; a passage on its own stops there. */
  private goesOnAfterClip(): boolean {
    return this.current.mode === "article" || this.hasNextSegment();
  }

  /** Moves the audio to the start of a sentence or phrase, without playing it. */
  private cue(segment: number) {
    const clips = this.clips();
    const cued = Math.min(Math.max(segment, 0), clips.length - 1);
    const currentTime = clips[cued].start;
    this.audio.currentTime = currentTime;
    this.update({ phase: "audio", segment: cued, currentTime });
  }

  private togglePause() {
    const s = this.current;
    if (s.phase === "failed") this.retry();
    else if (s.isPaused) this.resume();
    else this.pause();
  }

  private pause() {
    const s = this.current;
    if (s.phase === "yourTurn") {
      const turnRemainingMs = this.turnRemaining();
      this.clearTurnTimer();
      this.update({ isPaused: true, turnRemainingMs });
      return;
    }
    this.clearClipTimer();
    this.audio.pause();
    const currentTime = s.phase === "audio" ? this.audio.currentTime : s.currentTime;
    this.update({ isPaused: true, currentTime });
  }

  private resume() {
    const s = this.current;
    this.update({ isPaused: false });
    if (s.phase === "audio") this.play();
    else if (s.phase === "yourTurn") this.runTurnTimer(s.turnRemainingMs);
    // While loading, the load starts playback once it is done.
  }

  private play() {
    // Loading a new source can reset the rate.
    this.audio.playbackRate = this.current.speed;
    // Rejected when a pause or a new source interrupts it; real failures arrive as "error" events.
    this.audio.play().catch(() => undefined);
    this.watchClipEnd();
  }

  private applySpeed(speed: number) {
    this.audio.defaultPlaybackRate = speed;
    this.audio.playbackRate = speed;
  }

  /**
   * Ends the clip once the audio reaches its end. The timer is set by the
   * clock and checked against the audio, which may have started late.
   * The last clip ends with the audio itself.
   */
  private watchClipEnd() {
    this.clearClipTimer();
    const clips = this.clips();
    const { segment, speed } = this.current;
    if (segment + 1 >= clips.length) return;
    const remainingSeconds = clips[segment].end - this.audio.currentTime;
    if (remainingSeconds <= CLIP_END_SLACK_SECONDS) {
      this.finishClip();
      return;
    }
    this.clipTimer = this.timers.setTimeout(
      () => {
        this.clipTimer = null;
        this.watchClipEnd();
      },
      (remainingSeconds / speed) * 1000,
    );
  }

  private onEnded() {
    const s = this.current;
    // A stale event from audio that has been restarted or replaced since.
    if (s.phase !== "audio" || this.loadedIndex !== s.index || !this.audio.ended) return;
    this.finishClip();
  }

  /** After a clip: the learner's turn, or the end of a passage played on its own. */
  private finishClip() {
    this.clearClipTimer();
    this.audio.pause();
    const s = this.current;
    if (s.isPassageLooping || this.goesOnAfterClip()) this.startTurn();
    // Playing it again starts over.
    else this.update({ phase: "ended", segment: 0, currentTime: s.duration });
  }

  private advanceArticle() {
    const s = this.current;
    if (s.index + 1 < this.passageCount) this.start("article", s.index + 1);
    else if (s.isArticleLooping) this.start("article", 0);
    else this.update({ phase: "ended", segment: 0, currentTime: s.duration });
  }

  private startTurn() {
    const s = this.current;
    const clip = this.clips()[s.segment];
    const clipEnd = Math.min(clip.end, s.duration);
    const turnMs = repeatPauseMs(s.repeatPause, clipEnd - clip.start, s.speed);
    if (turnMs <= 0) {
      this.endTurn();
      return;
    }
    this.update({
      phase: "yourTurn",
      currentTime: clipEnd,
      turnRemainingMs: turnMs,
      turnTotalMs: turnMs,
    });
    this.runTurnTimer(turnMs);
  }

  private runTurnTimer(ms: number) {
    this.clearTurnTimer();
    this.turnEndsAt = this.timers.now() + ms;
    this.turnTimer = this.timers.setTimeout(() => {
      this.turnTimer = null;
      this.endTurn();
    }, ms);
  }

  /**
   * The learner's turn is over: the same clip plays again while looping,
   * otherwise the next one, or the article's next passage after the last one.
   */
  private endTurn() {
    const s = this.current;
    this.update({ turnRemainingMs: 0, turnTotalMs: 0 });
    if (!s.isPassageLooping && !this.hasNextSegment()) {
      this.advanceArticle();
      return;
    }
    this.cue(s.isPassageLooping ? s.segment : s.segment + 1);
    this.play();
  }

  /** Nothing follows the learner's turn any more, so it stops where it is. */
  private stopTurn() {
    this.clearTurnTimer();
    this.update({ isPassageLooping: false, phase: "ended", isPaused: false, turnRemainingMs: 0 });
  }

  private turnRemaining(): number {
    return Math.max(0, this.turnEndsAt - this.timers.now());
  }

  private clearTimers() {
    this.clearTurnTimer();
    this.clearClipTimer();
  }

  private clearTurnTimer() {
    if (this.turnTimer === null) return;
    this.timers.clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  private clearClipTimer() {
    if (this.clipTimer === null) return;
    this.timers.clearTimeout(this.clipTimer);
    this.clipTimer = null;
  }

  private onDuration() {
    const s = this.current;
    if (this.loadedIndex !== s.index) return;
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    this.update({ duration });
  }

  private onAudioError() {
    const s = this.current;
    if (this.loadedIndex !== s.index || s.phase !== "audio") return;
    this.fail(`The audio of passage ${s.index + 1} could not be played.`);
  }

  /** Stops at the passage that failed, rather than skipping it. */
  private fail(error: string) {
    this.clearTimers();
    this.loadedIndex = -1;
    this.audio.pause();
    this.update({ phase: "failed", error, isPaused: false });
  }

  private update(change: Partial<ShadowingState>) {
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) listener();
  }
}

function clipsKey(index: number, unit: SegmentUnit): string {
  return `${index}:${unit}`;
}
