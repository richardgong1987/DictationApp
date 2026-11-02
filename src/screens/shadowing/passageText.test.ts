import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitPieces, splitSentences } from "./passageText.ts";

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

describe("splitPieces", () => {
  it("marks where a clip may end, and where a short phrase only joins the next", () => {
    const text = "Eventually, I returned home, uncertain what to do next. Then it rained.";
    const marked = splitPieces(text).map((piece) => [text.slice(piece.from, piece.to), piece.end]);
    assert.deepEqual(marked, [
      ["Eventually,", "joined"],
      ["I returned home,", "phrase"],
      ["uncertain what to do next.", "sentence"],
      ["Then it rained.", "sentence"],
    ]);
  });
});
