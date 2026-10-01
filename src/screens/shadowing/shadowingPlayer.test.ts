import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  repeatPauseMs,
  ShadowingPlayer,
  type AudioOutput,
  type RepeatPause,
  type Timers,
} from "./shadowingPlayer.ts";

/** Behaves like an HTMLAudioElement, with the browser's side driven by the test. */
class FakeAudio implements AudioOutput {
  currentTime = 0;
  duration = NaN;
  paused = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  private source = "";
  private readonly listeners = new Map<string, (() => void)[]>();

  get src() {
    return this.source;
  }

  set src(url: string) {
    this.source = url;
    this.currentTime = 0;
    this.duration = NaN;
    this.paused = true;
  }

  get ended() {
    return this.currentTime >= this.duration;
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  load() {}

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** The browser has read the MP3's header. */
  loadMetadata(duration: number) {
    this.duration = duration;
    this.emit("loadedmetadata");
  }

  /** Playback reaches the end. */
  finish() {
    this.currentTime = this.duration;
    this.paused = true;
    this.emit("ended");
  }

  get isPlaying() {
    return !this.paused;
  }

  private emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class FakeTimers implements Timers {
  private time = 0;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; callback: () => void }>();

  now() {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number) {
    const id = this.nextId++;
    this.pending.set(id, { at: this.time + ms, callback });
    return id;
  }

  clearTimeout(id: number) {
    this.pending.delete(id);
  }

  get pendingCount() {
    return this.pending.size;
  }

  advance(ms: number) {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.pending].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at);
      if (due.length === 0) break;
      const [id, timer] = due[0];
      this.pending.delete(id);
      this.time = timer.at;
      timer.callback();
    }
    this.time = end;
  }
}

const PASSAGE_SECONDS = [2, 4, 3];
const urlOf = (index: number) => `blob:passage-${index}`;

/** Lets pending audio loads finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

let audio: FakeAudio;
let timers: FakeTimers;
let failingPassages: Set<number>;

function createPlayer(
  choices: { speed?: number; repeatPause?: RepeatPause; isArticleLooping?: boolean } = {},
) {
  const player = new ShadowingPlayer({
    audio,
    timers,
    passageCount: PASSAGE_SECONDS.length,
    passageUrl: (index) =>
      failingPassages.has(index)
        ? Promise.reject("Azure Speech credentials are not configured.")
        : Promise.resolve(urlOf(index)),
  });
  if (choices.speed) player.setSpeed(choices.speed);
  if (choices.repeatPause) player.setRepeatPause(choices.repeatPause);
  if (choices.isArticleLooping) player.setArticleLooping(true);
  return player;
}

/** Waits for the passage to load and lets the browser report its length. */
async function loadPassage(index: number) {
  await settle();
  assert.equal(audio.src, urlOf(index));
  audio.loadMetadata(PASSAGE_SECONDS[index]);
}

beforeEach(() => {
  audio = new FakeAudio();
  timers = new FakeTimers();
  failingPassages = new Set();
});

describe("a single passage", () => {
  it("plays once and stops at its end", async () => {
    const player = createPlayer();
    player.togglePassage(1);
    await loadPassage(1);
    assert.equal(audio.isPlaying, true);

    audio.finish();

    assert.equal(player.getState().phase, "ended");
    assert.equal(audio.isPlaying, false);
    assert.equal(timers.pendingCount, 0);
  });

  it("repeats after the learner's turn while looping", async () => {
    const player = createPlayer();
    player.togglePassageLoop(1);
    await loadPassage(1);

    audio.finish();
    assert.equal(player.getState().phase, "yourTurn");
    assert.equal(player.getState().turnRemainingMs, 3000);
    assert.equal(audio.isPlaying, false);

    timers.advance(2999);
    assert.equal(player.getState().phase, "yourTurn");
    timers.advance(1);
    assert.equal(player.getState().phase, "audio");
    assert.equal(audio.currentTime, 0);
    assert.equal(audio.isPlaying, true);
  });

  it("freezes the countdown while paused and continues it on resume", async () => {
    const player = createPlayer({ repeatPause: "fiveSeconds" });
    player.togglePassageLoop(0);
    await loadPassage(0);
    audio.finish();
    timers.advance(1500);

    player.togglePassage(0);
    assert.equal(player.getState().isPaused, true);
    assert.equal(player.getState().turnRemainingMs, 3500);
    assert.equal(timers.pendingCount, 0);

    timers.advance(60_000);
    assert.equal(player.getState().phase, "yourTurn");
    assert.equal(audio.isPlaying, false);

    player.togglePassage(0);
    timers.advance(3499);
    player.sample();
    assert.equal(player.getState().phase, "yourTurn");
    assert.equal(player.getState().turnRemainingMs, 1);
    timers.advance(1);
    assert.equal(player.getState().phase, "audio");
    assert.equal(audio.isPlaying, true);
  });

  it("gives as long as the passage takes at the current speed", async () => {
    const player = createPlayer({ repeatPause: "passageLength", speed: 0.75 });
    player.togglePassageLoop(2);
    await loadPassage(2);
    audio.finish();
    assert.equal(player.getState().turnTotalMs, 4000);
  });

  it("replays at once without a pause", async () => {
    const player = createPlayer({ repeatPause: "none" });
    player.togglePassageLoop(0);
    await loadPassage(0);
    audio.finish();
    assert.equal(player.getState().phase, "audio");
    assert.equal(audio.isPlaying, true);
    assert.equal(timers.pendingCount, 0);
  });

  it("stops where it is when looping is turned off during the learner's turn", async () => {
    const player = createPlayer();
    player.togglePassageLoop(0);
    await loadPassage(0);
    audio.finish();

    player.togglePassageLoop(0);

    assert.equal(player.getState().phase, "ended");
    assert.equal(timers.pendingCount, 0);
  });

  it("pauses and resumes the audio where it was", async () => {
    const player = createPlayer();
    player.togglePassage(1);
    await loadPassage(1);
    audio.currentTime = 1.5;

    player.togglePassage(1);
    assert.equal(audio.isPlaying, false);
    player.togglePassage(1);
    assert.equal(audio.isPlaying, true);
    assert.equal(audio.currentTime, 1.5);
  });
});

describe("the article", () => {
  it("plays every passage in order without pauses, then stops", async () => {
    const player = createPlayer({ repeatPause: "fiveSeconds" });
    player.toggleArticle();
    for (const index of [0, 1, 2]) {
      await loadPassage(index);
      assert.equal(player.getState().index, index);
      assert.equal(audio.isPlaying, true);
      audio.finish();
      assert.equal(timers.pendingCount, 0);
    }
    await settle();
    assert.equal(player.getState().phase, "ended");
    assert.equal(audio.isPlaying, false);
  });

  it("starts over after the last passage while looping", async () => {
    const player = createPlayer({ isArticleLooping: true });
    player.toggleArticle();
    for (const index of [0, 1, 2]) {
      await loadPassage(index);
      audio.finish();
    }
    await loadPassage(0);
    assert.equal(player.getState().mode, "article");
    assert.equal(audio.isPlaying, true);
  });

  it("resumes from the same position after a pause", async () => {
    const player = createPlayer();
    player.toggleArticle();
    await loadPassage(0);
    audio.currentTime = 1.2;

    player.toggleArticle();
    assert.equal(audio.isPlaying, false);
    player.toggleArticle();
    assert.equal(audio.isPlaying, true);
    assert.equal(audio.src, urlOf(0));
    assert.equal(audio.currentTime, 1.2);
  });

  it("stops at a passage whose audio fails, and retries it", async () => {
    failingPassages.add(1);
    const player = createPlayer();
    player.toggleArticle();
    await loadPassage(0);
    audio.finish();
    await settle();

    const failed = player.getState();
    assert.equal(failed.phase, "failed");
    assert.equal(failed.index, 1);
    assert.match(failed.error ?? "", /passage 2 .*credentials are not configured/);
    assert.equal(audio.isPlaying, false);

    failingPassages.clear();
    player.retry();
    await loadPassage(1);
    assert.equal(player.getState().mode, "article");
    assert.equal(audio.isPlaying, true);
  });
});

describe("switching between the article and single passages", () => {
  it("switches from the article to a passage at once, with one audio playing", async () => {
    const player = createPlayer();
    player.toggleArticle();
    await loadPassage(0);

    player.togglePassage(2);
    assert.equal(audio.isPlaying, false, "the article stops before the passage loads");
    await loadPassage(2);

    assert.equal(player.getState().mode, "passage");
    assert.equal(audio.isPlaying, true);
    audio.finish();
    await settle();
    assert.equal(player.getState().phase, "ended", "the article does not continue");
    assert.equal(audio.src, urlOf(2));
  });

  it("starts the article from the beginning after passage practice", async () => {
    const player = createPlayer();
    player.togglePassageLoop(1);
    await loadPassage(1);
    audio.finish();

    player.toggleArticle();

    assert.equal(timers.pendingCount, 0);
    await loadPassage(0);
    assert.equal(player.getState().mode, "article");
    assert.equal(player.getState().isPassageLooping, false);
    assert.equal(audio.isPlaying, true);
  });

  it("cancels the learner's turn when another passage starts", async () => {
    const player = createPlayer();
    player.togglePassageLoop(0);
    await loadPassage(0);
    audio.finish();

    player.togglePassage(1);
    assert.equal(timers.pendingCount, 0);
    await loadPassage(1);
    timers.advance(10_000);
    assert.equal(audio.src, urlOf(1));
    assert.equal(player.getState().phase, "audio");
  });

  it("cancels the learner's turn when the article restarts", async () => {
    const player = createPlayer();
    player.togglePassageLoop(2);
    await loadPassage(2);
    audio.finish();

    player.restartArticle();

    assert.equal(timers.pendingCount, 0);
    assert.equal(player.getState().mode, "article");
  });

  it("ignores a slow load that another passage overtook", async () => {
    let resolveFirst: (url: string) => void = () => undefined;
    const player = new ShadowingPlayer({
      audio,
      timers,
      passageCount: 3,
      passageUrl: (index) =>
        index === 0
          ? new Promise((resolve) => (resolveFirst = resolve))
          : Promise.resolve(urlOf(index)),
    });
    player.togglePassage(0);
    player.togglePassage(1);
    await settle();
    resolveFirst(urlOf(0));
    await settle();
    assert.equal(audio.src, urlOf(1));
    assert.equal(player.getState().index, 1);
  });
});

describe("leaving the screen", () => {
  it("stops playback and cancels the countdown and pending loads", async () => {
    const player = createPlayer();
    player.togglePassageLoop(0);
    await loadPassage(0);
    audio.finish();
    assert.equal(timers.pendingCount, 1);

    player.togglePassage(1);
    player.stop();
    await settle();

    assert.equal(timers.pendingCount, 0);
    assert.equal(audio.isPlaying, false);
    assert.equal(audio.src, "", "the load of passage 2 never lands");
    assert.equal(player.getState().mode, "idle");
  });
});

describe("repeatPauseMs", () => {
  it("matches the passage at the playback speed", () => {
    assert.equal(repeatPauseMs("passageLength", 3, 1), 3000);
    assert.equal(repeatPauseMs("passageLength", 3, 1.25), 2400);
    assert.equal(repeatPauseMs("none", 3, 1), 0);
    assert.equal(repeatPauseMs("fiveSeconds", 3, 0.6), 5000);
  });
});
