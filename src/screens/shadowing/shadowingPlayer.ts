// The one player of the shadowing screen. The article is read as one text, but
// each passage has its own audio; the player moves from one to the next, a part
// at a time, with one audio element. It is plain TypeScript so its rules can be
// tested without React or a browser.

import type { Clip, SegmentUnit } from "./passageSegments";

/**
 * How long the learner gets to repeat what they heard aloud before the audio
 * goes on: a number of seconds, where 0 is no pause, or as long as the clip took.
 */
export type RepeatPause = number | "clipLength";

/** How passages are played: whole, or a sentence or phrase at a time. */
export type RepeatUnit = "passage" | SegmentUnit;

/** A moment in one passage's audio, so that it holds in any unit. */
export interface ArticlePlace {
  index: number;
  seconds: number;
}

/**
 * Where the current passage is:
 * - `idle`: nothing has been played yet;
 * - `loading`: its audio is being fetched, or generated first;
 * - `audio`: its audio is playing, or paused;
 * - `yourTurn`: the pause for the learner to say a part aloud: after its audio,
 *   or before it when the learner goes first;
 * - `ended`: stopped at the end of the article;
 * - `failed`: its audio could not be loaded or played (see `error`).
 */
export type ShadowingPhase = "idle" | "loading" | "audio" | "yourTurn" | "ended" | "failed";

export interface ShadowingState {
  /** The passage in the player; while idle, the one the article starts from. */
  index: number;
  /**
   * The sentence or phrase playing, or the one that plays next once stopped.
   * Always 0 for a whole passage.
   */
  segment: number;
  phase: ShadowingPhase;
  /** The learner paused; resuming continues the audio or the countdown. */
  isPaused: boolean;
  /** Play the same passage, sentence or phrase again after the learner's turn, instead of going on. */
  isSegmentLooping: boolean;
  /** Start the article over after its last passage. */
  isArticleLooping: boolean;
  /** The learner reads each part aloud before its audio, which then corrects them. */
  isLearnerFirst: boolean;
  speed: number;
  repeatPause: RepeatPause;
  unit: RepeatUnit;
  /** Seconds into the current passage; while idle, where the article starts from. */
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

interface StartOptions {
  /** The part to start from; it can be LAST_SEGMENT. */
  segment?: number;
  /** Starts instead from the part at this point of the passage's audio. */
  atTime?: number;
  isSegmentLooping?: boolean;
}

export interface ShadowingPlayerOptions {
  audio: AudioOutput;
  timers: Timers;
  passageCount: number;
  /** Resolves a passage's audio to a playable URL, generating it first when needed. */
  passageUrl: (index: number) => Promise<string>;
  /** Where each sentence or phrase of a passage is in its audio, in order. */
  passageClips: (index: number, unit: SegmentUnit) => Promise<Clip[]>;
  /** Where an earlier visit stopped, if it did. */
  resumeFrom: ArticlePlace | null;
  /** Told of every part reached, and of null at the end of the article. */
  onPlaceReached: (place: ArticlePlace | null) => void;
}

const STOPPED = {
  phase: "idle",
  isPaused: false,
  isSegmentLooping: false,
  duration: 0,
  turnRemainingMs: 0,
  turnTotalMs: 0,
  error: null,
} as const satisfies Partial<ShadowingState>;

const INITIAL_STATE: ShadowingState = {
  ...STOPPED,
  index: 0,
  segment: 0,
  currentTime: 0,
  isArticleLooping: false,
  isLearnerFirst: true,
  speed: 1,
  repeatPause: 1,
  unit: "passage",
};

/** A whole passage is one clip, which ends where its audio does. */
const WHOLE_PASSAGE: readonly Clip[] = [{ start: 0, end: Infinity }];

/** A clip timer that fires this close to the clip's end has reached it. */
const CLIP_END_SLACK_SECONDS = 0.02;

/** A passage's last sentence or phrase, before it is known how many it has. */
const LAST_SEGMENT = Infinity;

/** Audio is playing or about to, or the learner's turn is counting down. */
export function isRunning(state: ShadowingState): boolean {
  if (state.isPaused) return false;
  return state.phase === "loading" || state.phase === "audio" || state.phase === "yourTurn";
}

/** The article has been started and has not reached its end. */
export function isUnderway({ phase }: ShadowingState): boolean {
  return phase !== "idle" && phase !== "ended";
}

/** An earlier visit stopped here, and this one has not started yet. */
export function hasSavedPlace({ phase, index, currentTime }: ShadowingState): boolean {
  return phase === "idle" && (index > 0 || currentTime > 0);
}

/** The learner's turn after hearing a clip that lasts `clipSeconds` at speed 1. */
export function repeatPauseMs(pause: RepeatPause, clipSeconds: number, speed: number): number {
  return (pause === "clipLength" ? clipSeconds / speed : pause) * 1000;
}

export class ShadowingPlayer {
  private readonly audio: AudioOutput;
  private readonly timers: Timers;
  private readonly passageCount: number;
  private readonly passageUrl: (index: number) => Promise<string>;
  private readonly passageClips: (index: number, unit: SegmentUnit) => Promise<Clip[]>;
  private readonly onPlaceReached: (place: ArticlePlace | null) => void;
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
  /** A turn before the audio is due as soon as the browser reports the audio's length. */
  private isTurnAwaitingDuration = false;
  /** Stops the audio at the end of a sentence or phrase. */
  private clipTimer: number | null = null;

  constructor(options: ShadowingPlayerOptions) {
    this.audio = options.audio;
    this.timers = options.timers;
    this.passageCount = options.passageCount;
    this.passageUrl = options.passageUrl;
    this.passageClips = options.passageClips;
    this.onPlaceReached = options.onPlaceReached;
    this.applySpeed(this.current.speed);
    this.audio.addEventListener("ended", () => this.onEnded());
    this.audio.addEventListener("loadedmetadata", () => this.onDuration());
    this.audio.addEventListener("durationchange", () => this.onDuration());
    this.audio.addEventListener("error", () => this.onAudioError());
    if (options.resumeFrom) {
      const { index, seconds: currentTime } = options.resumeFrom;
      this.current = { ...this.current, index, currentTime };
      this.findSavedSegment();
    }
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

  /**
   * Pauses and resumes the article. Before it has started it plays from where
   * an earlier visit stopped, or else from the top; once finished, from the top.
   */
  toggleArticle() {
    const s = this.current;
    if (isUnderway(s)) this.togglePause();
    else if (s.phase === "idle") this.start(s.index, { segment: s.segment, atTime: s.currentTime });
    else this.restartArticle();
  }

  restartArticle() {
    this.start(0);
  }

  setArticleLooping(isArticleLooping: boolean) {
    this.update({ isArticleLooping });
  }

  // -- Moving around --------------------------------------------------------

  /** Plays one part of the article, and carries on from there. */
  playSegment(index: number, segment: number) {
    this.start(index, { segment, isSegmentLooping: this.current.isSegmentLooping });
  }

  /** Plays the current sentence or phrase (or the whole passage) again from its beginning. */
  replaySegment() {
    this.playSegment(this.current.index, this.current.segment);
  }

  /** Moves to the next part of the article, into the next passage after a passage's last one. */
  nextSegment() {
    const { index, segment } = this.current;
    if (this.hasNextSegment()) this.playSegment(index, segment + 1);
    else if (index + 1 < this.passageCount) this.playSegment(index + 1, 0);
  }

  /** Moves to the previous part of the article, into the previous passage before a passage's first one. */
  previousSegment() {
    const { index, segment } = this.current;
    if (segment > 0) this.playSegment(index, segment - 1);
    else if (index > 0) this.playSegment(index - 1, LAST_SEGMENT);
  }

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
    const segment = this.segmentAt(currentTime);
    const isPaused = s.isPaused || s.phase === "ended";
    this.update({ phase: "audio", segment, currentTime, isPaused, turnRemainingMs: 0, turnTotalMs: 0 });
    if (segment !== s.segment) this.reportPlace();
    if (isPaused) return;
    if (s.phase === "audio") this.watchClipEnd();
    else this.play();
  }

  // -- Choices --------------------------------------------------------------

  /** Stays on the current part until turned off; then the article carries on from it. */
  toggleLoop() {
    const s = this.current;
    if (isUnderway(s)) this.update({ isSegmentLooping: !s.isSegmentLooping });
    else this.start(s.index, { segment: s.segment, isSegmentLooping: true });
  }

  setRepeatPause(repeatPause: RepeatPause) {
    this.update({ repeatPause });
  }

  /**
   * Carries on from the new part at the same point, so that a learner stuck
   * in a passage can switch to sentences and stay on the one they are in.
   */
  setUnit(unit: RepeatUnit) {
    const s = this.current;
    this.update({ unit });
    if (isUnderway(s)) {
      this.start(s.index, { atTime: s.currentTime, isSegmentLooping: s.isSegmentLooping });
    } else if (hasSavedPlace(s)) {
      this.findSavedSegment();
    }
  }

  /** Starts the current part over in the new order, so that the change shows at once. */
  toggleLearnerFirst() {
    const s = this.current;
    this.update({ isLearnerFirst: !s.isLearnerFirst });
    if (isUnderway(s)) {
      this.start(s.index, { segment: s.segment, isSegmentLooping: s.isSegmentLooping });
    }
  }

  /** The learner is ready before the countdown is over. */
  finishTurn() {
    if (this.current.phase !== "yourTurn") return;
    this.clearTurnTimer();
    this.update({ isPaused: false });
    this.endTurn();
  }

  /** Loads the failed passage again and plays it. */
  retry() {
    const s = this.current;
    if (s.phase !== "failed") return;
    this.start(s.index, { segment: s.segment, isSegmentLooping: s.isSegmentLooping });
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

  /**
   * Stops playback and cancels the countdown and any pending load, as when
   * leaving the screen. It stays at its place: React's development mode stops
   * a new player once, before anything has played.
   */
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

  /**
   * Makes `index` the current passage and plays it from the start of a part.
   * Whatever was playing or counting down stops first.
   */
  private start(index: number, { segment = 0, atTime, isSegmentLooping = false }: StartOptions = {}) {
    this.clearTimers();
    const loadId = ++this.loadId;
    const { unit } = this.current;
    const unitToFind = unit !== "passage" && !this.knownClips.has(clipsKey(index, unit)) ? unit : null;
    const hasAudio = this.loadedIndex === index;
    const isReady = hasAudio && unitToFind === null;
    // Which part is at `atTime` depends on the sentences or phrases being loaded.
    const firstSegment = () => (atTime === undefined ? segment : this.segmentAt(atTime));
    this.update({
      index,
      segment,
      isPaused: false,
      isSegmentLooping,
      phase: isReady ? "audio" : "loading",
      currentTime: 0,
      duration: hasAudio ? this.current.duration : 0,
      turnRemainingMs: 0,
      turnTotalMs: 0,
      error: null,
    });

    if (isReady) {
      this.cue(firstSegment());
      this.beginPart();
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
        this.loaded(index, url, firstSegment());
      },
      (error: unknown) => {
        if (loadId !== this.loadId) return;
        const reason = error instanceof Error ? error.message : String(error);
        this.fail(`The audio of passage ${index + 1} could not be loaded: ${reason}`);
      },
    );
  }

  /** `url` is null when the passage's audio was in the player already. */
  private loaded(index: number, url: string | null, segment: number) {
    if (url !== null) {
      this.loadedIndex = index;
      this.audio.src = url;
    }
    this.cue(segment);
    this.beginPart();
    this.preloadAfter(index);
  }

  /** Fetches (or generates) the passage the article plays next, so it starts without a wait. */
  private preloadAfter(index: number) {
    const s = this.current;
    const next = index + 1 < this.passageCount ? index + 1 : s.isArticleLooping ? 0 : index;
    // A failure shows up, with a retry, once the article reaches that passage.
    if (next !== index) this.passageUrl(next).catch(() => undefined);
  }

  /** The clips of the passage in the player: its sentences or phrases, or the whole of it. */
  private clips(): readonly Clip[] {
    const { index, unit } = this.current;
    if (unit === "passage") return WHOLE_PASSAGE;
    return this.knownClips.get(clipsKey(index, unit)) ?? WHOLE_PASSAGE;
  }

  private hasNextSegment(): boolean {
    return this.current.segment + 1 < this.clips().length;
  }

  /** The sentence or phrase of the current passage at this point of its audio. */
  private segmentAt(seconds: number): number {
    const startedClips = this.clips().filter((clip) => clip.start <= seconds);
    return Math.max(0, startedClips.length - 1);
  }

  /** Moves the audio to the start of a sentence or phrase, without playing it. */
  private cue(segment: number) {
    const clips = this.clips();
    const cued = Math.min(Math.max(segment, 0), clips.length - 1);
    const currentTime = clips[cued].start;
    this.audio.currentTime = currentTime;
    this.update({ phase: "audio", segment: cued, currentTime });
  }

  /** Starts the part just cued, with the learner's reading or with its audio. */
  private beginPart() {
    const s = this.current;
    this.reportPlace();
    if (s.isLearnerFirst) {
      // Moving within a passage leaves its audio playing.
      this.audio.pause();
      this.startReading();
    } else if (!s.isPaused) {
      // The learner may have paused while it was loading.
      this.play();
    }
  }

  /** The turn can last as long as the audio, so it waits for the browser to measure that. */
  private startReading() {
    this.isTurnAwaitingDuration = this.current.duration === 0;
    if (this.isTurnAwaitingDuration) this.update({ phase: "loading" });
    else this.startTurn();
  }

  /** Reported as each part is reached, since the app can be closed at any moment. */
  private reportPlace() {
    const { index, segment } = this.current;
    this.onPlaceReached({ index, seconds: this.clips()[segment].start });
  }

  /** Finds the part that holds the saved place, to show it before anything plays. */
  private findSavedSegment() {
    const { index, unit, currentTime } = this.current;
    if (unit === "passage" || currentTime === 0) {
      this.update({ segment: 0 });
      return;
    }
    this.passageClips(index, unit).then((clips) => {
      const s = this.current;
      if (s.phase !== "idle" || s.unit !== unit) return;
      if (clips.length > 0) this.knownClips.set(clipsKey(index, unit), clips);
      this.update({ segment: this.segmentAt(currentTime) });
    });
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

  /** Unless the learner went first, their turn follows the clip; no pause skips it. */
  private finishClip() {
    this.clearClipTimer();
    this.audio.pause();
    if (this.current.isLearnerFirst) this.moveOn();
    else this.startTurn();
  }

  private advanceArticle() {
    const s = this.current;
    if (s.index + 1 < this.passageCount) this.start(s.index + 1);
    else if (s.isArticleLooping) this.start(0);
    else this.finishArticle();
  }

  /** Playing it again starts over, in this visit and the next. */
  private finishArticle() {
    this.update({ phase: "ended", segment: 0, currentTime: this.current.duration });
    this.onPlaceReached(null);
  }

  private startTurn() {
    const s = this.current;
    const clip = this.clips()[s.segment];
    const clipEnd = Math.min(clip.end, s.duration);
    // With no pause, the parts play back to back, whoever goes first.
    const turnMs = repeatPauseMs(s.repeatPause, clipEnd - clip.start, s.speed);
    if (turnMs <= 0) {
      this.endTurn();
      return;
    }
    this.update({
      phase: "yourTurn",
      currentTime: s.isLearnerFirst ? clip.start : clipEnd,
      turnRemainingMs: turnMs,
      turnTotalMs: turnMs,
    });
    if (!s.isPaused) this.runTurnTimer(turnMs);
  }

  private runTurnTimer(ms: number) {
    this.clearTurnTimer();
    this.turnEndsAt = this.timers.now() + ms;
    this.turnTimer = this.timers.setTimeout(() => {
      this.turnTimer = null;
      this.endTurn();
    }, ms);
  }

  /** The learner has spoken: the audio now plays what they read, or the article moves on. */
  private endTurn() {
    const s = this.current;
    this.update({ turnRemainingMs: 0, turnTotalMs: 0 });
    if (s.isLearnerFirst) {
      this.cue(s.segment);
      this.play();
    } else {
      this.moveOn();
    }
  }

  /**
   * The same clip again while looping, otherwise the next one, or the next
   * passage after a passage's last one.
   */
  private moveOn() {
    const s = this.current;
    if (!s.isSegmentLooping && !this.hasNextSegment()) {
      this.advanceArticle();
      return;
    }
    this.cue(s.isSegmentLooping ? s.segment : s.segment + 1);
    this.beginPart();
  }

  private turnRemaining(): number {
    return Math.max(0, this.turnEndsAt - this.timers.now());
  }

  private clearTimers() {
    this.clearTurnTimer();
    this.clearClipTimer();
    this.isTurnAwaitingDuration = false;
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
    if (this.isTurnAwaitingDuration && duration > 0) this.startReading();
  }

  private onAudioError() {
    const s = this.current;
    const isAudioNeeded =
      s.phase === "audio" || s.phase === "yourTurn" || this.isTurnAwaitingDuration;
    if (this.loadedIndex !== s.index || !isAudioNeeded) return;
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
