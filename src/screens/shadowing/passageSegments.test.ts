import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findPauses,
  segmentPassage,
  type Clip,
  type PassageTiming,
  type SegmentUnit,
} from "./passageSegments.ts";

/** A typical voice says this many letters a second. */
const LETTERS_PER_SECOND = 16;

/** Text the voice says faster (above 1) or slower than its usual pace. */
interface Paced {
  text: string;
  speed: number;
}

/**
 * A passage as a voice would say it: each string takes as long as its
 * letters, each number is a silence of that many seconds after it.
 */
function speak(...parts: (string | Paced | number)[]): { text: string; timing: PassageTiming } {
  const words: string[] = [];
  const pauses = [{ start: 0, end: 0.2 }];
  let time = 0.2;
  for (const part of parts) {
    if (typeof part === "number") {
      pauses.push({ start: time, end: time + part });
      time += part;
    } else {
      const { text, speed } = typeof part === "string" ? { text: part, speed: 1 } : part;
      words.push(text);
      time += (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) / (LETTERS_PER_SECOND * speed);
    }
  }
  pauses.push({ start: time, end: time + 0.8 });
  return { text: words.join(" "), timing: { duration: time + 0.8, pauses } };
}

/** A breath between sentences, as Gemini takes one: hiss, a softer fade, then a little silence. */
const BREATH = "breath";
const SAMPLE_RATE = 1000;

/**
 * The audio of a passage, sample by sample: a tone for each string, as long
 * as its letters; silence for each number of seconds; a breath for BREATH.
 * Also says where each breath is.
 */
function record(...parts: (string | number | typeof BREATH)[]) {
  const words: string[] = [];
  const breaths: Clip[] = [];
  const chunks = [new Float32Array(0.2 * SAMPLE_RATE)];
  let time = 0.2;
  const add = (seconds: number, sample: (i: number) => number) => {
    chunks.push(Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, i) => sample(i)));
    time += seconds;
  };
  // Hiss at a steady level, so many decibels below the tone.
  const hiss = (decibels: number) => (i: number) => (i % 2 ? 1 : -1) * 0.354 * 10 ** (decibels / 20);
  for (const part of parts) {
    if (part === BREATH) {
      const start = time;
      add(0.3, hiss(-30));
      add(0.1, hiss(-40));
      add(0.12, () => 0);
      breaths.push({ start, end: time });
    } else if (typeof part === "number") {
      add(part, () => 0);
    } else {
      words.push(part);
      add((part.match(/[\p{L}\p{N}]/gu)?.length ?? 0) / LETTERS_PER_SECOND, (i) => 0.5 * Math.sin(i / 3));
    }
  }
  add(0.8, () => 0);
  const samples = new Float32Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  chunks.reduce((at, chunk) => (samples.set(chunk, at), at + chunk.length), 0);
  return { text: words.join(" "), samples, breaths };
}

function pieces(spoken: { text: string; timing: PassageTiming }, unit: SegmentUnit): string[] {
  return segmentPassage(spoken.text, spoken.timing, unit).map((segment) =>
    spoken.text.slice(segment.from, segment.to),
  );
}

describe("segmentPassage", () => {
  it("cuts a passage at the pauses after its sentences", () => {
    const spoken = speak(
      "Imagine a school robot that delivers lunch.", 0.95,
      "A door may close.", 0.95,
      "A child may enter its path.",
    );
    const segments = segmentPassage(spoken.text, spoken.timing, "sentence");

    assert.deepEqual(pieces(spoken, "sentence"), [
      "Imagine a school robot that delivers lunch.",
      "A door may close.",
      "A child may enter its path.",
    ]);
    // Each clip starts and ends inside the pause next to it, and the passage is covered.
    const [first, second] = segments.map((segment) => segment.clip);
    const pause = spoken.timing.pauses[1];
    assert.equal(first.start, 0);
    assert.ok(first.end > pause.start && first.end < pause.end);
    assert.ok(second.start > first.end && second.start < pause.end);
    assert.equal(segments[2].clip.end, spoken.timing.duration);
  });

  it("keeps sentences together where the voice does not pause between them", () => {
    const spoken = speak("Dr. Smith arrived.", 0.9, "The lesson began at once.");
    assert.deepEqual(pieces(spoken, "sentence"), ["Dr. Smith arrived.", "The lesson began at once."]);

    const run = speak("It rained.", "We stayed inside.", 0.9, "Then the sun came out.");
    assert.deepEqual(pieces(run, "sentence"), [
      "It rained. We stayed inside.",
      "Then the sun came out.",
    ]);
  });

  it("splits sentences into phrases at commas, keeping list items together", () => {
    const spoken = speak(
      "Chapters Three,", 0.25, "Four,", 0.2,
      "and Five of the book examine different ways to build an agent.", 0.95,
      "The robot must collect the correct meal,", 0.21,
      "reach the correct classroom,", 0.21,
      "and respond when circumstances change.",
    );
    assert.deepEqual(pieces(spoken, "phrase"), [
      "Chapters Three, Four, and Five of the book examine different ways to build an agent.",
      "The robot must collect the correct meal,",
      "reach the correct classroom,",
      "and respond when circumstances change.",
    ]);
  });

  it("does not cut where the voice barely pauses", () => {
    const spoken = speak(
      "They explain how an agent can reason from rules,", 0.08,
      "choose goals and plans,", 0.24,
      "and respond quickly to events.",
    );
    assert.deepEqual(pieces(spoken, "phrase"), [
      "They explain how an agent can reason from rules, choose goals and plans,",
      "and respond quickly to events.",
    ]);
  });

  it("prefers a pause where the boundary is expected over a longer one elsewhere", () => {
    const spoken = speak(
      "Their internal", 1.2,
      "database might say that the robot is in the corridor.", 0.5,
      "Rules describe which conclusions follow.",
    );
    const [first] = segmentPassage(spoken.text, spoken.timing, "sentence");
    const sentenceEnd = spoken.timing.pauses[2];
    assert.ok(first.clip.end > sentenceEnd.start && first.clip.end < sentenceEnd.end);
  });

  it("finds the same cuts in fast and slow speech", () => {
    const spoken = speak(
      "They explain how an agent can reason from rules,", 0.08,
      "choose goals and plans,", 0.22,
      "and respond quickly to events.",
    );
    for (const speed of [0.5, 1, 2]) {
      assert.deepEqual(pieces({ ...spoken, timing: atSpeed(spoken.timing, speed) }, "phrase"), [
        "They explain how an agent can reason from rules, choose goals and plans,",
        "and respond quickly to events.",
      ]);
    }
  });

  it("keeps each sentence's sound with its text when the voice breathes between sentences", () => {
    // Only the end of a breath is silent. The short silences after the commas
    // used to take the sentence ends, putting every later clip out of step.
    const names = ["Emily", "Grace", "Hannah", "Isla", "Julia", "Lucy"];
    const spoken = record(
      ...names.flatMap((name, index) => [
        `The first time I noticed ${name},`, 0.2,
        "autumn had already turned the streets into gold, brown and deep red.",
        ...(index < names.length - 1 ? [BREATH] : []),
      ]),
    );
    const timing = {
      duration: spoken.samples.length / SAMPLE_RATE,
      pauses: findPauses(spoken.samples, SAMPLE_RATE),
    };

    const segments = segmentPassage(spoken.text, timing, "sentence");

    assert.equal(segments.length, names.length);
    spoken.breaths.forEach((breath, index) => {
      const { end } = segments[index].clip;
      assert.ok(end > breath.start && end <= breath.end + 0.12, `sentence ${index + 1} ends at ${end}s`);
    });
  });

  it("keeps a sentence end at its own pause when a short word after it pauses longer", () => {
    // "Eventually," is too short to play on its own, yet a voice may linger after it.
    const spoken = speak(
      "As the hours passed,", 0.25, "I became increasingly worried.", 0.4,
      { text: "I walked through the neighbourhood and checked several places we often visited together.", speed: 1.2 }, 0.3,
      "Eventually,", 0.6, "I returned home,", 0.27, "uncertain what to do next.",
    );
    const segments = segmentPassage(spoken.text, spoken.timing, "sentence");

    assert.deepEqual(pieces(spoken, "sentence"), [
      "As the hours passed, I became increasingly worried.",
      "I walked through the neighbourhood and checked several places we often visited together.",
      "Eventually, I returned home, uncertain what to do next.",
    ]);
    const sentenceEnd = spoken.timing.pauses[3];
    assert.ok(segments[1].clip.end > sentenceEnd.start && segments[1].clip.end <= sentenceEnd.end);
  });

  it("is a single segment when the audio has no pauses", () => {
    const text = "Imagine a robot. It delivers lunch.";
    const segments = segmentPassage(text, { duration: 3, pauses: [] }, "phrase");
    assert.deepEqual(segments, [{ from: 0, to: text.length, clip: { start: 0, end: 3 } }]);
  });
});

/** The same passage spoken faster or slower, pauses included. */
function atSpeed(timing: PassageTiming, speed: number): PassageTiming {
  return {
    duration: timing.duration / speed,
    pauses: timing.pauses.map((pause) => ({ start: pause.start / speed, end: pause.end / speed })),
  };
}

describe("findPauses", () => {
  it("finds the silences between sounds", () => {
    const sampleRate = 1000;
    // 0.2 s silence, 0.5 s tone, 0.3 s silence, 0.4 s tone, 0.1 s silence.
    const samples = new Float32Array(1500);
    const tone = (from: number, to: number) => {
      for (let i = from; i < to; i++) samples[i] = 0.5 * Math.sin(i / 3);
    };
    tone(200, 700);
    tone(1000, 1400);

    const pauses = findPauses(samples, sampleRate).map(({ start, end }) => [
      Math.round(start * 100) / 100,
      Math.round(end * 100) / 100,
    ]);

    assert.deepEqual(pauses, [
      [0, 0.2],
      [0.7, 1],
      [1.4, 1.5],
    ]);
  });

  it("counts the soft end of a breath as part of the pause", () => {
    const sampleRate = 1000;
    // Tone, then 0.15 s of breath 40 dB below it, 0.1 s of silence, and tone again.
    const samples = new Float32Array(1150);
    for (let i = 0; i < 500; i++) samples[i] = 0.5 * Math.sin(i / 3);
    for (let i = 500; i < 650; i++) samples[i] = i % 2 === 0 ? 0.0035 : -0.0035;
    for (let i = 750; i < 1150; i++) samples[i] = 0.5 * Math.sin(i / 3);

    const pauses = findPauses(samples, sampleRate).map(({ start, end }) => [
      Math.round(start * 100) / 100,
      Math.round(end * 100) / 100,
    ]);

    assert.deepEqual(pauses, [[0.5, 0.75]]);
  });

  it("finds nothing in silence", () => {
    assert.deepEqual(findPauses(new Float32Array(1000), 1000), []);
  });
});
