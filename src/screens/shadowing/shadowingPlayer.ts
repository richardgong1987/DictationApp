// The one player of the shadowing screen. Every control goes through it, so
// the article and single passages share one audio element and never overlap.
// It is plain TypeScript so its rules can be tested without React or a browser.

/** How long the learner gets to repeat a looping passage aloud before it plays again. */
export type RepeatPause = "none" | "threeSeconds" | "fiveSeconds" | "passageLength";

/**
 * - `idle`: nothing has been played yet.
 * - `article`: every passage in lesson order, without pauses in between.
 * - `passage`: one passage on its own, optionally looping with time to repeat it aloud.
 */
export type ShadowingMode = "idle" | "article" | "passage";

/**
 * Where the current passage is:
 * - `loading`: its audio is being fetched, or generated first;
 * - `audio`: its audio is playing, or paused;
 * - `yourTurn`: the pause after a looping passage, for the learner to repeat it aloud;
 * - `ended`: stopped at the end of the passage, or of the article;
 * - `failed`: its audio could not be loaded or played (see `error`).
 */
export type ShadowingPhase = "loading" | "audio" | "yourTurn" | "ended" | "failed";

export interface ShadowingState {
  mode: ShadowingMode;
  /** The passage in the player; meaningless while `mode` is idle. */
  index: number;
  phase: ShadowingPhase;
  /** The learner paused; resuming continues the audio or the countdown. */
  isPaused: boolean;
  /** Passage mode only: play the passage again after the learner's turn. */
  isPassageLooping: boolean;
  /** Start the article over after its last passage. */
  isArticleLooping: boolean;
  /** For single passages and the article alike. */
  speed: number;
  /** Used only while a single passage loops. */
  repeatPause: RepeatPause;
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
}

const STOPPED = {
  mode: "idle",
  index: 0,
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
  repeatPause: "threeSeconds",
};

/** Audio is playing or about to, or the learner's turn is counting down. */
export function isRunning(state: ShadowingState): boolean {
  if (state.mode === "idle" || state.isPaused) return false;
  return state.phase === "loading" || state.phase === "audio" || state.phase === "yourTurn";
}

/** The learner's turn after one playing of a passage that lasts `passageSeconds` at speed 1. */
export function repeatPauseMs(pause: RepeatPause, passageSeconds: number, speed: number): number {
  switch (pause) {
    case "none":
      return 0;
    case "threeSeconds":
      return 3000;
    case "fiveSeconds":
      return 5000;
    case "passageLength":
      return (passageSeconds / speed) * 1000;
  }
}

export class ShadowingPlayer {
  private readonly audio: AudioOutput;
  private readonly timers: Timers;
  private readonly passageCount: number;
  private readonly passageUrl: (index: number) => Promise<string>;
  private readonly listeners = new Set<() => void>();
  private current: ShadowingState = INITIAL_STATE;
  /** The passage whose audio is in `audio.src`; -1 while none is, or while it is being replaced. */
  private loadedIndex = -1;
  /** Bumped by every load, so that a slow load that was overtaken is ignored. */
  private loadId = 0;
  private turnTimer: number | null = null;
  private turnEndsAt = 0;

  constructor(options: ShadowingPlayerOptions) {
    this.audio = options.audio;
    this.timers = options.timers;
    this.passageCount = options.passageCount;
    this.passageUrl = options.passageUrl;
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
    const s = this.current;
    if (s.mode !== "article" || s.phase === "ended") this.restartArticle();
    else this.togglePause();
  }

  restartArticle() {
    this.start("article", 0);
  }

  setArticleLooping(isArticleLooping: boolean) {
    this.update({ isArticleLooping });
  }

  // -- Single passages ------------------------------------------------------

  /** Plays or pauses a passage on its own; during the article it switches to that passage. */
  togglePassage(index: number) {
    if (!this.isPractising(index)) this.start("passage", index);
    else if (this.current.phase === "ended") this.replayPassage(index);
    else this.togglePause();
  }

  replayPassage(index: number) {
    this.start("passage", index, this.isPractising(index) && this.current.isPassageLooping);
  }

  togglePassageLoop(index: number) {
    const s = this.current;
    if (!this.isPractising(index) || (!s.isPassageLooping && s.phase === "ended")) {
      this.start("passage", index, true);
    } else if (s.isPassageLooping && s.phase === "yourTurn") {
      // Stops where it is rather than playing once more.
      this.clearTurnTimer();
      this.update({ isPassageLooping: false, phase: "ended", isPaused: false, turnRemainingMs: 0 });
    } else {
      this.update({ isPassageLooping: !s.isPassageLooping });
    }
  }

  setRepeatPause(repeatPause: RepeatPause) {
    this.update({ repeatPause });
  }

  // -- Either mode ----------------------------------------------------------

  /** Moves within the passage in the player. From the learner's turn it goes back to the audio. */
  seek(seconds: number) {
    const s = this.current;
    if (this.loadedIndex !== s.index || s.phase === "loading" || s.phase === "failed") return;
    this.clearTurnTimer();
    const currentTime = Math.min(Math.max(seconds, 0), s.duration);
    this.audio.currentTime = currentTime;
    const isPaused = s.isPaused || s.phase === "ended";
    this.update({ phase: "audio", currentTime, isPaused, turnRemainingMs: 0, turnTotalMs: 0 });
    if (s.phase !== "audio" && !isPaused) this.play();
  }

  /** Loads the failed passage again and plays it. */
  retry() {
    const s = this.current;
    if (s.phase !== "failed" || s.mode === "idle") return;
    this.start(s.mode, s.index, s.isPassageLooping);
  }

  setSpeed(speed: number) {
    this.applySpeed(speed);
    this.update({ speed });
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
    this.clearTurnTimer();
    this.loadId++;
    this.loadedIndex = -1;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.update(STOPPED);
  }

  // -- Internals ------------------------------------------------------------

  private isPractising(index: number): boolean {
    return this.current.mode === "passage" && this.current.index === index;
  }

  /**
   * Makes `index` the current passage in `mode` and plays it from the
   * beginning. Whatever was playing or counting down stops first.
   */
  private start(mode: "article" | "passage", index: number, isPassageLooping = false) {
    this.clearTurnTimer();
    const loadId = ++this.loadId;
    const isLoaded = this.loadedIndex === index;
    this.update({
      mode,
      index,
      isPaused: false,
      isPassageLooping,
      phase: isLoaded ? "audio" : "loading",
      currentTime: 0,
      duration: isLoaded ? this.current.duration : 0,
      turnRemainingMs: 0,
      turnTotalMs: 0,
      error: null,
    });

    if (isLoaded) {
      this.audio.currentTime = 0;
      this.play();
      return;
    }

    this.audio.pause();
    this.loadedIndex = -1;
    this.passageUrl(index).then(
      (url) => {
        if (loadId === this.loadId) this.loaded(index, url);
      },
      (error: unknown) => {
        if (loadId !== this.loadId) return;
        const reason = error instanceof Error ? error.message : String(error);
        this.fail(`The audio of passage ${index + 1} could not be loaded: ${reason}`);
      },
    );
  }

  private loaded(index: number, url: string) {
    this.loadedIndex = index;
    this.audio.src = url;
    this.update({ phase: "audio" });
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
  }

  private applySpeed(speed: number) {
    this.audio.defaultPlaybackRate = speed;
    this.audio.playbackRate = speed;
  }

  private onEnded() {
    const s = this.current;
    // A stale event from audio that has been restarted or replaced since.
    if (s.phase !== "audio" || this.loadedIndex !== s.index || !this.audio.ended) return;
    if (s.mode === "article") this.advanceArticle();
    else if (s.isPassageLooping) this.startTurn();
    else this.update({ phase: "ended", currentTime: s.duration });
  }

  private advanceArticle() {
    const s = this.current;
    if (s.index + 1 < this.passageCount) this.start("article", s.index + 1);
    else if (s.isArticleLooping) this.start("article", 0);
    else this.update({ phase: "ended", currentTime: s.duration });
  }

  private startTurn() {
    const s = this.current;
    const turnMs = repeatPauseMs(s.repeatPause, s.duration, s.speed);
    if (turnMs <= 0) {
      this.endTurn();
      return;
    }
    this.update({
      phase: "yourTurn",
      currentTime: s.duration,
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

  /** The learner's turn is over: the passage plays again from the beginning. */
  private endTurn() {
    this.update({ phase: "audio", currentTime: 0, turnRemainingMs: 0, turnTotalMs: 0 });
    this.audio.currentTime = 0;
    this.play();
  }

  private turnRemaining(): number {
    return Math.max(0, this.turnEndsAt - this.timers.now());
  }

  private clearTurnTimer() {
    if (this.turnTimer === null) return;
    this.timers.clearTimeout(this.turnTimer);
    this.turnTimer = null;
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
    this.clearTurnTimer();
    this.loadedIndex = -1;
    this.audio.pause();
    this.update({ phase: "failed", error, isPaused: false });
  }

  private update(change: Partial<ShadowingState>) {
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) listener();
  }
}
