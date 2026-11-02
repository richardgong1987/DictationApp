import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { GeminiVoice, SettingsDetail } from "../../api/types";
import {
  accentOf,
  ANY,
  filterOptions,
  filterVoices,
  genderOf,
  languageName,
  languageOf,
  voiceLabel,
  type FilterOption,
} from "./geminiVoices";
import SuggestionField from "./SuggestionField";

/** Offered until the full list loads, which takes a saved API key. */
const GEMINI_VOICES = [
  { id: "Kore", label: "Kore: firm" },
  { id: "Charon", label: "Charon: informative" },
  { id: "Iapetus", label: "Iapetus: clear" },
  { id: "Erinome", label: "Erinome: clear" },
  { id: "Schedar", label: "Schedar: even" },
  { id: "Achird", label: "Achird: friendly" },
  { id: "Sulafat", label: "Sulafat: warm" },
  { id: "Puck", label: "Puck: upbeat" },
];

interface VoiceFieldProps {
  value: string;
  onChange: (voice: string) => void;
}

/** Gemini's whole voice list once the saved key can fetch it, otherwise a few suggestions. */
export default function GeminiVoiceField({
  detail,
  value,
  onChange,
}: VoiceFieldProps & { detail: SettingsDetail }) {
  const [catalog, setCatalog] = useState<GeminiVoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  // `detail` changes on every save, so fixing a wrong key loads the list.
  useEffect(() => {
    if (!detail.geminiConfigured) return;
    let isCancelled = false;
    setError(null);
    api
      .listGeminiVoices()
      .then((voices) => !isCancelled && setCatalog(voices))
      .catch((e) => !isCancelled && setError(errorMessage(e)));
    return () => {
      isCancelled = true;
    };
  }, [detail]);

  if (catalog.length > 0) {
    return <VoiceCatalog voices={catalog} value={value} onChange={onChange} />;
  }
  return (
    <>
      <SuggestionField label="Voice" value={value} suggestions={GEMINI_VOICES} onChange={onChange} />
      <p className="muted small">
        {error
          ? `Could not load Gemini's full voice list: ${error}`
          : detail.geminiConfigured
            ? "Loading Gemini's full voice list…"
            : "Save your API key to choose from Gemini's full voice list, by language and regional accent."}
      </p>
    </>
  );
}

function VoiceCatalog({ voices, value, onChange }: VoiceFieldProps & { voices: GeminiVoice[] }) {
  const [language, setLanguage] = useState(ANY);
  const [accent, setAccent] = useState(ANY);
  const [gender, setGender] = useState(ANY);
  const inLanguage = filterVoices(voices, { language, accent: ANY, gender: ANY });
  const matching = filterVoices(voices, { language, accent, gender });
  const selected = voices.find((voice) => voice.id === value);
  // The saved voice stays visible even when the filters leave it out.
  const isSelectedFilteredOut = !matching.some((voice) => voice.id === value);

  function chooseLanguage(nextLanguage: string) {
    setLanguage(nextLanguage);
    // Accents belong to a language, so the old one may not exist in the new one.
    setAccent(ANY);
  }

  return (
    <>
      <FilterField
        label="Language"
        value={language}
        options={filterOptions(voices, languageOf, languageName)}
        onChange={chooseLanguage}
      />
      <FilterField
        label="Accent"
        value={accent}
        options={filterOptions(inLanguage, accentOf)}
        onChange={setAccent}
      />
      <FilterField
        label="Gender"
        value={gender}
        options={filterOptions(inLanguage, genderOf)}
        onChange={setGender}
      />
      <label>
        Voice
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {isSelectedFilteredOut && (
            <option value={value}>{selected ? voiceLabel(selected) : value}</option>
          )}
          {matching.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voiceLabel(voice)}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        {matching.length} of {voices.length} voices match. {selected?.description}
      </p>
    </>
  );
}

interface FilterFieldProps {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

function FilterField({ label, value, options, onChange }: FilterFieldProps) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ANY}>Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
