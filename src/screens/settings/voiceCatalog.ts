// Narrowing a provider's voice list. Filter values come from the list itself:
// Google's accents are specific ("Liverpool English", "Fukuoka Japanese"), and
// Azure's are its locales ("en-GB"), so a fixed set of filters would miss most.

import type { CatalogVoice, VoiceFilter } from "../../api/types";

/** The filter value that matches every voice. */
export const ANY = "";

const UNSPECIFIED = "Unspecified";

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], {
  type: "language",
  languageDisplay: "standard",
});
const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

export interface FilterOption {
  value: string;
  label: string;
}

/** The voice list as a filter leaves it. */
export interface NarrowedVoices {
  /** The filter in force: what the list still offers of the one asked for. */
  filter: VoiceFilter;
  languages: FilterOption[];
  accents: FilterOption[];
  genders: FilterOption[];
  matching: CatalogVoice[];
}

export function languageOf(voice: CatalogVoice): string {
  return voice.languageCode || UNSPECIFIED;
}

export function accentOf(voice: CatalogVoice): string {
  return voice.accent || UNSPECIFIED;
}

export function genderOf(voice: CatalogVoice): string {
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
  voices: CatalogVoice[],
  valueOf: (voice: CatalogVoice) => string,
  labelOf: (value: string) => string = (value) => value,
): FilterOption[] {
  return [...new Set(voices.map(valueOf))]
    .map((value) => ({ value, label: labelOf(value) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function filterVoices(voices: CatalogVoice[], filter: VoiceFilter): CatalogVoice[] {
  const matches = (wanted: string, value: string) => wanted === ANY || wanted === value;
  return voices.filter(
    (voice) =>
      matches(filter.language, languageOf(voice)) &&
      matches(filter.accent, accentOf(voice)) &&
      matches(filter.gender, genderOf(voice)),
  );
}

/**
 * Applies a filter, which may have been saved long ago. A value the list does
 * not offer counts as Any, because the lists change and accents depend on the
 * language; matching nothing under a menu that reads Any would look broken.
 */
export function narrowVoices(voices: CatalogVoice[], wanted: VoiceFilter): NarrowedVoices {
  const languages = filterOptions(voices, languageOf, languageName);
  const language = offeredOrAny(wanted.language, languages);
  const inLanguage = filterVoices(voices, { language, accent: ANY, gender: ANY });
  const accents = filterOptions(inLanguage, accentOf);
  const genders = filterOptions(inLanguage, genderOf);
  const filter = {
    language,
    accent: offeredOrAny(wanted.accent, accents),
    gender: offeredOrAny(wanted.gender, genders),
  };
  return { filter, languages, accents, genders, matching: filterVoices(voices, filter) };
}

function offeredOrAny(value: string, options: FilterOption[]): string {
  return options.some((option) => option.value === value) ? value : ANY;
}

/**
 * "Rosalind (Liverpool English, female, medium pitch)", or for a voice
 * without a finer accent, where its language is spoken: "Sonia (United Kingdom, Female)".
 */
export function voiceLabel(voice: CatalogVoice): string {
  const name = voice.displayName || voice.id;
  const where = voice.accent || (voice.languageCode && placeName(voice.languageCode));
  const traits = [where, voice.gender, voice.pitch && `${voice.pitch} pitch`].filter(Boolean);
  return traits.length > 0 ? `${name} (${traits.join(", ")})` : name;
}

/** "en-GB" -> "United Kingdom"; a code without a region names its language. */
function placeName(code: string): string {
  try {
    const { region } = new Intl.Locale(code);
    return region ? (REGION_NAMES.of(region) ?? region) : languageName(code);
  } catch {
    return code;
  }
}
