import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Clip, SegmentUnit } from "./passageSegments.ts";
import {
  repeatPauseMs,
  ShadowingPlayer,
  type AudioOutput,
  type RepeatPause,
  type RepeatUnit,
  type Timers,
} from "./shadowingPlayer.ts";

/**
 * Behaves like an HTMLAudioElement, with the browser's side driven by the
 * test. While playing, its position moves with the fake clock.
 */
class FakeAudio implements AudioOutput {
  duration = NaN;
  paused = true;
  defaultPlaybackRate = 1;
  /** How long the audio takes to start sounding after play(). */
  startLatencyMs = 0;
  private rate = 1;
  /** The position at the clock's `positionAt`. */
  private position = 0;
  private positionAt = 0;
  private source = "";
  private readonly listeners = new Map<string, (() => void)[]>();
  private readonly clock: { now(): number };

  constructor(clock: { now(): number }) {
    this.clock = clock;
  }

  get currentTime() {
    if (this.paused) return this.position;
    const played = (Math.max(0, this.clock.now() - this.positionAt) / 1000) * this.rate;
    return Math.min(this.position + played, Number.isNaN(this.duration) ? Infinity : this.duration);
  }

  set currentTime(seconds: number) {
    this.position = seconds;
    this.positionAt = this.clock.now();
  }

  get playbackRate() {
    return this.rate;
  }

  set playbackRate(rate: number) {
    this.currentTime = this.currentTime;
    this.rate = rate;
  }

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
    if (this.paused) {
      this.position = this.currentTime;
      this.positionAt = this.clock.now() + this.startLatencyMs;
    }
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.position = this.currentTime;
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
    this.paused = true;
    this.currentTime = this.duration;
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
/** Passage 2 has three sentences; passage 3's could not be measured. Times are exact in binary. */
const SENTENCES_OF_PASSAGE_2: Clip[] = [
  { start: 0, end: 1.25 },
  { start: 1, end: 2.5 },
  { start: 2.25, end: 4 },
];
const clipsOf = (index: number): Clip[] =>
  index === 1 ? SENTENCES_OF_PASSAGE_2 : index === 2 ? [] : [{ start: 0, end: PASSAGE_SECONDS[index] }];

/** Lets pending audio loads finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

let audio: FakeAudio;
let timers: FakeTimers;
let failingPassages: Set<number>;
let clipRequests: [number, SegmentUnit][];

function createPlayer(
  choices: {
    speed?: number;
    repeatPause?: RepeatPause;
    unit?: RepeatUnit;
    isArticleLooping?: boolean;
  } = {},
) {
  const player = new ShadowingPlayer({
    audio,
    timers,
    passageCount: PASSAGE_SECONDS.length,
    passageUrl: (index) =>
      failingPassages.has(index)
        ? Promise.reject("Azure Speech credentials are not configured.")
        : Promise.resolve(urlOf(index)),
    passageClips: (index, unit) => {
      clipRequests.push([index, unit]);
      return Promise.resolve(clipsOf(index));
    },
  });
  if (choices.speed) player.setSpeed(choices.speed);
  if (choices.repeatPause) player.setRepeatPause(choices.repeatPause);
  if (choices.unit) player.setUnit(choices.unit);
  if (choices.isArticleLooping) player.setArticleLooping(true);
  return player;
}

/** Waits for the passage to load and lets the browser report its length. */
async function loadPassage(index: number) {
  await settle();
  assert.equal(audio.src, urlOf(index));
  audio.loadMetadata(PASSAGE_SECONDS[index]);
}

const position = (player: ShadowingPlayer) => {
  const { index, segment, phase } = player.getState();
  return { index, segment, phase };
};
const at = (index: number, segment: number, phase: string) => ({ index, segment, phase });

beforeEach(() => {
  timers = new FakeTimers();
  audio = new FakeAudio(timers);
  failingPassages = new Set();
  clipRequests = [];
});

describe("playing the article", () => {
  it("plays every passage in order without pauses by default, then stops", async () => {
    const player = createPlayer();
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

  it("plays again from the beginning once finished", async () => {
    const player = createPlayer();
    player.toggleArticle();
    for (const index of [0, 1, 2]) {
      await loadPassage(index);
      audio.finish();
    }
    await settle();

    player.toggleArticle();

    await loadPassage(0);
    assert.deepEqual(position(player), at(0, 0, "audio"));
  });

  it("starts over after the last passage while looping", async () => {
    const player = createPlayer({ isArticleLooping: true });
    player.toggleArticle();
    for (const index of [0, 1, 2]) {
      await loadPassage(index);
      audio.finish();
    }
    await loadPassage(0);
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
    assert.equal(audio.isPlaying, true);
  });

  it("restarts from the beginning, cancelling the learner's turn", async () => {
    const player = createPlayer({ repeatPause: 3 });
    player.playSegment(2, 0);
    await loadPassage(2);
    audio.finish();
    assert.equal(player.getState().phase, "yourTurn");

    player.restartArticle();

    assert.equal(timers.pendingCount, 0);
    await loadPassage(0);
    assert.deepEqual(position(player), at(0, 0, "audio"));
  });
});

describe("the learner's turn", () => {
  it("comes after every sentence of every passage, including the last one", async () => {
    const player = createPlayer({ unit: "sentence", repeatPause: 3 });
    player.toggleArticle();
    await loadPassage(0);
    audio.finish();
    assert.deepEqual(position(player), at(0, 0, "yourTurn"));
    assert.equal(audio.isPlaying, false);

    timers.advance(3000);
    await loadPassage(1);
    assert.deepEqual(position(player), at(1, 0, "audio"));

    timers.advance(1249);
    assert.equal(audio.isPlaying, true);
    timers.advance(1);
    assert.deepEqual(position(player), at(1, 0, "yourTurn"));
    timers.advance(2999);
    assert.deepEqual(position(player), at(1, 0, "yourTurn"));
    timers.advance(1);
    assert.deepEqual(position(player), at(1, 1, "audio"));
    assert.equal(audio.currentTime, 1);

    timers.advance(1500 + 3000);
    assert.deepEqual(position(player), at(1, 2, "audio"));
    audio.finish();
    assert.deepEqual(position(player), at(1, 2, "yourTurn"));

    timers.advance(3000);
    await loadPassage(2);
    audio.finish();
    assert.deepEqual(position(player), at(2, 0, "yourTurn"));

    timers.advance(3000);
    assert.equal(player.getState().phase, "ended");
    assert.equal(timers.pendingCount, 0);
  });

  it("comes after every whole passage", async () => {
    const player = createPlayer({ repeatPause: 5 });
    player.toggleArticle();
    await loadPassage(0);

    audio.finish();
    assert.deepEqual(position(player), at(0, 0, "yourTurn"));
    assert.equal(player.getState().turnTotalMs, 5000);

    timers.advance(5000);
    await loadPassage(1);
    assert.deepEqual(position(player), at(1, 0, "audio"));
    assert.deepEqual(clipRequests, []);
  });

  it("is skipped without a pause, from sentence to sentence and into the next passage", async () => {
    const player = createPlayer({ unit: "sentence" });
    player.toggleArticle();
    await loadPassage(0);
    audio.finish();
    await loadPassage(1);

    timers.advance(1250);
    assert.deepEqual(position(player), at(1, 1, "audio"));
    assert.equal(audio.isPlaying, true);
  });

  it("freezes its countdown while paused and continues it on resume", async () => {
    const player = createPlayer({ repeatPause: 5 });
    player.toggleArticle();
    await loadPassage(0);
    audio.finish();
    timers.advance(1500);

    player.toggleArticle();
    assert.equal(player.getState().isPaused, true);
    assert.equal(player.getState().turnRemainingMs, 3500);
    assert.equal(timers.pendingCount, 0);

    timers.advance(60_000);
    assert.equal(player.getState().phase, "yourTurn");
    assert.equal(audio.isPlaying, false);

    player.toggleArticle();
    timers.advance(3499);
    player.sample();
    assert.equal(player.getState().phase, "yourTurn");
    assert.equal(player.getState().turnRemainingMs, 1);
    timers.advance(1);
    await loadPassage(1);
    assert.equal(audio.isPlaying, true);
  });

  it("lasts as long as the passage takes at the current speed", async () => {
    const player = createPlayer({ repeatPause: "clipLength", speed: 0.75 });
    player.playSegment(2, 0);
    await loadPassage(2);
    audio.finish();
    assert.equal(player.getState().turnTotalMs, 4000);
  });

  it("lasts as long as the sentence takes at the current speed", async () => {
    const player = createPlayer({ unit: "sentence", repeatPause: "clipLength", speed: 0.5 });
    player.playSegment(1, 0);
    await loadPassage(1);
    timers.advance(2500);
    assert.equal(player.getState().phase, "yourTurn");
    assert.equal(player.getState().turnTotalMs, 2500);
  });

  it("waits for audio that started late before ending a sentence", async () => {
    audio.startLatencyMs = 100;
    const player = createPlayer({ unit: "sentence", repeatPause: 3 });
    player.playSegment(1, 0);
    await loadPassage(1);

    timers.advance(1250);
    assert.equal(player.getState().phase, "audio");
    timers.advance(100);
    assert.equal(player.getState().phase, "yourTurn");
  });

  it("starts on time after the speed changes during a sentence", async () => {
    const player = createPlayer({ unit: "sentence", repeatPause: 3 });
    player.playSegment(1, 0);
    await loadPassage(1);
    timers.advance(750);

    player.setSpeed(0.5);

    timers.advance(999);
    assert.equal(player.getState().phase, "audio");
    timers.advance(1);
    assert.equal(player.getState().phase, "yourTurn");
  });
});

describe("looping", () => {
  it("repeats a passage with the learner's turn in between", async () => {
    const player = createPlayer({ repeatPause: 3 });
    player.toggleLoop();
    await loadPassage(0);

    audio.finish();
    assert.deepEqual(position(player), at(0, 0, "yourTurn"));
    assert.equal(player.getState().turnRemainingMs, 3000);
    assert.equal(audio.isPlaying, false);

    timers.advance(2999);
    assert.equal(player.getState().phase, "yourTurn");
    timers.advance(1);
    assert.deepEqual(position(player), at(0, 0, "audio"));
    assert.equal(audio.currentTime, 0);
    assert.equal(audio.isPlaying, true);
  });

  it("repeats at once without a pause", async () => {
    const player = createPlayer();
    player.toggleLoop();
    await loadPassage(0);

    audio.finish();

    assert.deepEqual(position(player), at(0, 0, "audio"));
    assert.equal(audio.isPlaying, true);
    assert.equal(timers.pendingCount, 0);
  });

  it("repeats a hard sentence for as long as needed, then carries on from it", async () => {
    const player = createPlayer({ unit: "sentence", repeatPause: 3 });
    player.playSegment(1, 1);
    await loadPassage(1);

    player.toggleLoop();
    timers.advance(1500 + 3000);
    assert.deepEqual(position(player), at(1, 1, "audio"), "first repetition");
    timers.advance(1500 + 3000);
    assert.deepEqual(position(player), at(1, 1, "audio"), "second repetition");

    player.toggleLoop();
    timers.advance(1500 + 3000);
    assert.deepEqual(position(player), at(1, 2, "audio"));
    audio.finish();
    timers.advance(3000);
    await loadPassage(2);
    assert.deepEqual(position(player), at(2, 0, "audio"));
  });

  it("goes on to the next passage when turned off after the last sentence", async () => {
    const player = createPlayer({ unit: "sentence", repeatPause: 3 });
    player.playSegment(1, 2);
    player.toggleLoop();
    await loadPassage(1);
    audio.finish();

    player.toggleLoop();

    assert.deepEqual(position(player), at(1, 2, "yourTurn"));
    timers.advance(3000);
    await loadPassage(2);
    assert.deepEqual(position(player), at(2, 0, "audio"));
  });

  it("stays on while moving to another sentence", async () => {
    const player = createPlayer({ unit: "sentence" });
    player.playSegment(1, 0);
    player.toggleLoop();
    await loadPassage(1);

    player.playSegment(1, 2);

    assert.deepEqual(position(player), at(1, 2, "audio"));
    assert.equal(player.getState().isSegmentLooping, true);
    assert.equal(audio.currentTime, 2.25);
    assert.equal(audio.isPlaying, true);
  });

  it("stays on while moving to another passage", async () => {
    const player = createPlayer();
    player.toggleLoop();
    await loadPassage(0);

    player.playSegment(1, 0);

    await loadPassage(1);
    assert.equal(player.getState().isSegmentLooping, true);
  });
});

describe("moving around the article", () => {
  /** Plays up to the learner's turn after the second sentence of passage 2. */
  async function reachTurnAfterSecondSentence(player: ShadowingPlayer) {
    player.playSegment(1, 1);
    await loadPassage(1);
    timers.advance(1500);
    assert.deepEqual(position(player), at(1, 1, "yourTurn"));
  }

  it("plays from a sentence that is clicked and carries on", async () => {
    const player = createPlayer({ unit: "sentence" });
    player.playSegment(1, 2);
    await loadPassage(1);

    audio.finish();

    await loadPassage(2);
    assert.deepEqual(position(player), at(2, 0, "audio"));
  });

  it("moves to another passage at once, with one audio playing", async () => {
    const player = createPlayer();
    player.toggleArticle();
    await loadPassage(0);

    player.playSegment(2, 0);
    assert.equal(audio.isPlaying, false, "the audio stops before the passage loads");
    await loadPassage(2);

    assert.equal(player.getState().index, 2);
    assert.equal(audio.isPlaying, true);
  });

  it("cancels the learner's turn when moving to another passage", async () => {
    const player = createPlayer({ repeatPause: 3 });
    player.toggleArticle();
    await loadPassage(0);
    audio.finish();

    player.playSegment(1, 0);
    assert.equal(timers.pendingCount, 0);
    await loadPassage(1);
    timers.advance(10_000);
    assert.equal(audio.src, urlOf(1));
    assert.equal(player.getState().phase, "audio");
  });

  it("replays the current sentence and carries on", async () => {
    const player = createPlayer({ unit: "sentence", repeatPause: 3 });
    await reachTurnAfterSecondSentence(player);

    player.replaySegment();

    assert.deepEqual(position(player), at(1, 1, "audio"));
    assert.equal(audio.currentTime, 1);
    timers.advance(1500 + 3000);
    assert.deepEqual(position(player), at(1, 2, "audio"));
  });

  it("steps through the sentences and on into the next passage", async () => {
    const player = createPlayer({ unit: "sentence" });
    player.playSegment(1, 1);
    await loadPassage(1);

    player.nextSegment();
    assert.deepEqual(position(player), at(1, 2, "audio"));

    player.nextSegment();
    await loadPassage(2);
    assert.deepEqual(position(player), at(2, 0, "audio"));
  });

  it("steps back into the last sentence of the previous passage", async () => {
    const player = createPlayer({ unit: "sentence" });
    player.playSegment(2, 0);
    await loadPassage(2);

    player.previousSegment();

    await loadPassage(1);
    assert.deepEqual(position(player), at(1, 2, "audio"));
    assert.equal(audio.currentTime, 2.25);
  });

  it("steps from passage to passage when playing whole passages", async () => {
    const player = createPlayer();
    player.toggleArticle();
    await loadPassage(0);

    player.nextSegment();
    await loadPassage(1);
    assert.deepEqual(position(player), at(1, 0, "audio"));

    player.previousSegment();
    await loadPassage(0);
    assert.deepEqual(position(player), at(0, 0, "audio"));
  });

  it("stays put at the very beginning and the very end", async () => {
    const player = createPlayer();
    player.toggleArticle();
    await loadPassage(0);
    audio.currentTime = 1;
    player.previousSegment();
    assert.equal(audio.currentTime, 1);

    player.playSegment(2, 0);
    await loadPassage(2);
    audio.currentTime = 1;
    player.nextSegment();
    assert.equal(audio.currentTime, 1);
  });

  it("moves to the sentence at the point the learner seeks to", async () => {
    const player = createPlayer({ unit: "sentence", repeatPause: 3 });
    player.playSegment(1, 0);
    await loadPassage(1);

    player.seek(2);

    assert.deepEqual(position(player), at(1, 1, "audio"));
    timers.advance(500);
    assert.deepEqual(position(player), at(1, 1, "yourTurn"));
  });
});

describe("changing the unit", () => {
  it("carries on from the sentence at the same point, so a hard one can be looped", async () => {
    const player = createPlayer({ repeatPause: 3 });
    player.playSegment(1, 0);
    await loadPassage(1);
    audio.currentTime = 3;
    player.sample();

    player.setUnit("sentence");
    await settle();

    assert.deepEqual(clipRequests, [[1, "sentence"]]);
    assert.deepEqual(position(player), at(1, 2, "audio"));
    assert.equal(audio.currentTime, 2.25);
    assert.equal(audio.isPlaying, true);
  });

  it("goes back to the whole passage from its beginning", async () => {
    const player = createPlayer({ unit: "sentence" });
    player.playSegment(1, 2);
    await loadPassage(1);

    player.setUnit("passage");
    await settle();

    assert.deepEqual(position(player), at(1, 0, "audio"));
    assert.equal(audio.currentTime, 0);
  });

  it("keeps looping", async () => {
    const player = createPlayer({ repeatPause: 3 });
    player.playSegment(1, 0);
    player.toggleLoop();
    await loadPassage(1);

    player.setUnit("sentence");
    await settle();

    assert.equal(player.getState().isSegmentLooping, true);
  });

  it("waits for the next start when nothing is playing", () => {
    const player = createPlayer();
    player.setUnit("sentence");
    assert.equal(player.getState().phase, "idle");
    assert.deepEqual(clipRequests, []);
  });

  it("plays a passage whole when its sentences are not known", async () => {
    const player = createPlayer({ unit: "sentence" });
    player.playSegment(2, 0);
    await loadPassage(2);
    assert.equal(timers.pendingCount, 0);
    audio.finish();
    assert.equal(player.getState().phase, "ended");
  });
});

describe("slow loads", () => {
  it("ignores a load that another passage overtook", async () => {
    let resolveFirst: (url: string) => void = () => undefined;
    const player = new ShadowingPlayer({
      audio,
      timers,
      passageCount: 3,
      passageUrl: (index) =>
        index === 0
          ? new Promise((resolve) => (resolveFirst = resolve))
          : Promise.resolve(urlOf(index)),
      passageClips: (index) => Promise.resolve(clipsOf(index)),
    });
    player.playSegment(0, 0);
    player.playSegment(1, 0);
    await settle();
    resolveFirst(urlOf(0));
    await settle();
    assert.equal(audio.src, urlOf(1));
    assert.equal(player.getState().index, 1);
  });
});

describe("leaving the screen", () => {
  it("stops playback and cancels the countdown and pending loads", async () => {
    const player = createPlayer({ repeatPause: 3 });
    player.toggleLoop();
    await loadPassage(0);
    audio.finish();
    assert.equal(timers.pendingCount, 1);

    player.playSegment(1, 0);
    player.stop();
    await settle();

    assert.equal(timers.pendingCount, 0);
    assert.equal(audio.isPlaying, false);
    assert.equal(audio.src, "", "the load of passage 2 never lands");
    assert.equal(player.getState().phase, "idle");
  });
});

describe("repeatPauseMs", () => {
  it("matches the clip at the playback speed", () => {
    assert.equal(repeatPauseMs("clipLength", 3, 1), 3000);
    assert.equal(repeatPauseMs("clipLength", 3, 1.25), 2400);
  });

  it("waits the chosen seconds at any speed", () => {
    assert.equal(repeatPauseMs(0, 3, 1), 0);
    assert.equal(repeatPauseMs(2, 3, 0.6), 2000);
    assert.equal(repeatPauseMs(8, 3, 0.6), 8000);
  });
});
