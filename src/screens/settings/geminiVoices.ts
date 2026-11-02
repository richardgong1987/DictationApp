// Narrowing Gemini's voice list. Filter values come from the list itself:
// Google's accents are specific ("Liverpool English", "Fukuoka Japanese"), so a
// fixed set of filters would miss most of them.

import type { GeminiVoice } from "../../api/types";

/** The filter value that matches every voice. */
export const ANY = "";

const UNSPECIFIED = "Unspecified";

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], {
  type: "language",
  languageDisplay: "standard",
});

export interface VoiceFilter {
  language: string;
  accent: string;
  gender: string;
}

export interface FilterOption {
  value: string;
  label: string;
}

export function languageOf(voice: GeminiVoice): string {
  return voice.languageCode || UNSPECIFIED;
}

export function accentOf(voice: GeminiVoice): string {
  return voice.accent || UNSPECIFIED;
}

export function genderOf(voice: GeminiVoice): string {
  return voice.gender || UNSPECIFIED;
}

/** "fr-FR" -> "French (France)"; a code Intl cannot read is shown as it is. */
export function languageName(code: string): string {
  try {
    return LANGUAGE_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The distinct values a filter can offer, sorted by what the learner reads. */
export function filterOptions(
  voices: GeminiVoice[],
  valueOf: (voice: GeminiVoice) => string,
  labelOf: (value: string) => string = (value) => value,
): FilterOption[] {
  return [...new Set(voices.map(valueOf))]
    .map((value) => ({ value, label: labelOf(value) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function filterVoices(voices: GeminiVoice[], filter: VoiceFilter): GeminiVoice[] {
  const matches = (wanted: string, value: string) => wanted === ANY || wanted === value;
  return voices.filter(
    (voice) =>
      matches(filter.language, languageOf(voice)) &&
      matches(filter.accent, accentOf(voice)) &&
      matches(filter.gender, genderOf(voice)),
  );
}

/** "Rosalind (Liverpool English, female, medium pitch)" */
export function voiceLabel(voice: GeminiVoice): string {
  const name = voice.displayName || voice.id;
  const traits = [voice.accent, voice.gender, voice.pitch && `${voice.pitch} pitch`].filter(Boolean);
  return traits.length > 0 ? `${name} (${traits.join(", ")})` : name;
}
