import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findPauses,
  segmentPassage,
  splitSentences,
  type PassageTiming,
  type SegmentUnit,
} from "./passageSegments.ts";

/** A typical voice says this many letters a second. */
const LETTERS_PER_SECOND = 16;

/**
 * A passage as a voice would say it: each string takes as long as its
 * letters, each number is a silence of that many seconds after it.
 */
function speak(...parts: (string | number)[]): { text: string; timing: PassageTiming } {
  const words: string[] = [];
  const pauses = [{ start: 0, end: 0.2 }];
  let time = 0.2;
  for (const part of parts) {
    if (typeof part === "number") {
      pauses.push({ start: time, end: time + part });
      time += part;
    } else {
      words.push(part);
      time += (part.match(/[\p{L}\p{N}]/gu)?.length ?? 0) / LETTERS_PER_SECOND;
    }
  }
  pauses.push({ start: time, end: time + 0.8 });
  return { text: words.join(" "), timing: { duration: time + 0.8, pauses } };
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

describe("splitSentences", () => {
  const sentences = (text: string) =>
    splitSentences(text).map((range) => text.slice(range.from, range.to));

  it("ends sentences at full stops, question and exclamation marks", () => {
    assert.deepEqual(sentences("Where is it? Over there! Thanks.  "), [
      "Where is it?",
      "Over there!",
      "Thanks.",
    ]);
  });

  it("keeps quotation marks with their sentence", () => {
    assert.deepEqual(sentences("It needs “the corridor is blocked.” Producing that is hard."), [
      "It needs “the corridor is blocked.”",
      "Producing that is hard.",
    ]);
  });

  it("does not end sentences at abbreviations and initials", () => {
    assert.deepEqual(sentences("Mr. Smith met J. K. Rowling, e.g. at lunch. They talked."), [
      "Mr. Smith met J. K. Rowling, e.g. at lunch.",
      "They talked.",
    ]);
  });

  it("understands Chinese and Japanese punctuation", () => {
    assert.deepEqual(sentences("今天天气很好。我们去公园吧！"), ["今天天气很好。", "我们去公园吧！"]);
  });
});

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

  it("finds nothing in silence", () => {
    assert.deepEqual(findPauses(new Float32Array(1000), 1000), []);
  });
});
