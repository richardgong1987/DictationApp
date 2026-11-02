import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CatalogVoice } from "../../api/types";
import {
  accentOf,
  ANY,
  filterOptions,
  filterVoices,
  genderOf,
  languageName,
  languageOf,
  narrowVoices,
  voiceLabel,
} from "./voiceCatalog.ts";

function voice(overrides: Partial<CatalogVoice>): CatalogVoice {
  return {
    id: "voice",
    displayName: null,
    languageCode: null,
    accent: null,
    gender: null,
    pitch: null,
    description: null,
    ...overrides,
  };
}

const liverpool = voice({
  id: "scouse",
  languageCode: "en-GB",
  accent: "Liverpool English",
  gender: "female",
});
const manchester = voice({
  id: "manc",
  languageCode: "en-GB",
  accent: "Manchester English",
  gender: "male",
});
const dublin = voice({
  id: "dublin",
  languageCode: "en-IE",
  accent: "Dublin English",
  gender: "female",
});
const uncategorized = voice({ id: "Puck" });
const voices = [liverpool, manchester, dublin, uncategorized];

describe("filterVoices", () => {
  it("collects every British city under one language", () => {
    const british = filterVoices(voices, { language: "en-GB", accent: ANY, gender: ANY });
    assert.deepEqual(british, [liverpool, manchester]);
  });

  it("narrows by language and gender together", () => {
    const chosen = filterVoices(voices, { language: "en-GB", accent: ANY, gender: "female" });
    assert.deepEqual(chosen, [liverpool]);
  });

  it("keeps every voice when nothing is chosen", () => {
    assert.deepEqual(filterVoices(voices, { language: ANY, accent: ANY, gender: ANY }), voices);
  });
});

describe("filterOptions", () => {
  it("names languages and sorts them by that name", () => {
    // Engines word "en-GB" differently, so these are codes they all spell out.
    const french = voice({ id: "fr", languageCode: "fr-FR" });
    assert.deepEqual(filterOptions([french, dublin, uncategorized], languageOf, languageName), [
      { value: "en-IE", label: "English (Ireland)" },
      { value: "fr-FR", label: "French (France)" },
      { value: "Unspecified", label: "Unspecified" },
    ]);
  });

  it("offers each accent once, from the voices it is given", () => {
    const british = filterVoices(voices, { language: "en-GB", accent: ANY, gender: ANY });
    assert.deepEqual(
      filterOptions(british, accentOf).map((option) => option.value),
      ["Liverpool English", "Manchester English"],
    );
  });

  it("gives voices without a gender a value of their own", () => {
    assert.deepEqual(
      filterOptions(voices, genderOf).map((option) => option.value),
      ["female", "male", "Unspecified"],
    );
  });
});

describe("narrowVoices", () => {
  const values = (options: { value: string }[]) => options.map((option) => option.value);

  it("restores a saved filter and offers what fits its language", () => {
    const saved = { language: "en-GB", accent: "Liverpool English", gender: "female" };
    const narrowed = narrowVoices(voices, saved);
    assert.deepEqual(narrowed.filter, saved);
    assert.deepEqual(narrowed.matching, [liverpool]);
    assert.deepEqual(values(narrowed.accents), ["Liverpool English", "Manchester English"]);
    assert.deepEqual(values(narrowed.genders), ["female", "male"]);
  });

  it("offers every voice when nothing was saved", () => {
    const narrowed = narrowVoices(voices, { language: ANY, accent: ANY, gender: ANY });
    assert.deepEqual(narrowed.matching, voices);
  });

  it("counts an accent Google has removed as Any rather than matching nothing", () => {
    const saved = { language: "en-GB", accent: "Winchester English", gender: ANY };
    const narrowed = narrowVoices(voices, saved);
    assert.equal(narrowed.filter.accent, ANY);
    assert.deepEqual(narrowed.matching, [liverpool, manchester]);
  });

  it("counts a removed language as Any, along with the accent that depended on it", () => {
    const saved = { language: "cy-GB", accent: "Cardiff Welsh", gender: "female" };
    const narrowed = narrowVoices(voices, saved);
    assert.deepEqual(narrowed.filter, { language: ANY, accent: ANY, gender: "female" });
    assert.deepEqual(narrowed.matching, [liverpool, dublin]);
  });

  it("counts a gender the language does not have as Any", () => {
    const saved = { language: "en-IE", accent: ANY, gender: "male" };
    const narrowed = narrowVoices(voices, saved);
    assert.equal(narrowed.filter.gender, ANY);
    assert.deepEqual(narrowed.matching, [dublin]);
  });
});

describe("languageName", () => {
  it("shows a code it cannot read rather than failing", () => {
    assert.equal(languageName("not a language code"), "not a language code");
  });
});

describe("voiceLabel", () => {
  it("names the voice and what sets it apart", () => {
    const label = voiceLabel(
      voice({ displayName: "Rosalind", accent: "Bristol English", gender: "female", pitch: "medium" }),
    );
    assert.equal(label, "Rosalind (Bristol English, female, medium pitch)");
  });

  it("says where a voice without a finer accent is from", () => {
    // Azure's voices: the locale is the accent.
    const sonia = voice({ displayName: "Sonia", languageCode: "en-GB", gender: "Female" });
    assert.equal(voiceLabel(sonia), "Sonia (United Kingdom, Female)");
    assert.equal(voiceLabel(voice({ displayName: "Ana", languageCode: "es-419" })), "Ana (Latin America)");
    assert.equal(voiceLabel(voice({ displayName: "Zed", languageCode: "fr" })), "Zed (French)");
  });

  it("falls back to the id and leaves out unknown traits", () => {
    assert.equal(voiceLabel(voice({ id: "Puck" })), "Puck");
  });
});
