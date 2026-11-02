import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { CatalogVoice, SettingsDetail, VoiceFilter } from "../../api/types";
import SuggestionField, { type Suggestion } from "./SuggestionField";
import { ANY, narrowVoices, voiceLabel, type FilterOption } from "./voiceCatalog";

/** What differs between the providers whose voice list the app can load. */
const CATALOGS = {
  azure: {
    name: "Azure",
    load: api.listAzureVoices,
    isReady: (detail: SettingsDetail) => detail.azureConfigured,
    setupHint: "Save your key and region to choose from Azure's full voice list, by language and accent.",
  },
  gemini: {
    name: "Gemini",
    load: api.listGeminiVoices,
    isReady: (detail: SettingsDetail) => detail.geminiConfigured,
    setupHint: "Save your API key to choose from Gemini's full voice list, by language and regional accent.",
  },
};

export type CatalogProvider = keyof typeof CATALOGS;

interface VoiceFieldProps {
  value: string;
  onChange: (voice: string) => void;
  filter: VoiceFilter;
  onFilterChange: (filter: VoiceFilter) => void;
}

interface VoiceCatalogFieldProps extends VoiceFieldProps {
  provider: CatalogProvider;
  detail: SettingsDetail;
  /** Offered until the full list loads. */
  suggestions: Suggestion[];
}

/** The provider's whole voice list once the saved credentials can fetch it, otherwise a few suggestions. */
export default function VoiceCatalogField({
  provider,
  detail,
  suggestions,
  ...field
}: VoiceCatalogFieldProps) {
  const source = CATALOGS[provider];
  const isReady = source.isReady(detail);
  const [catalog, setCatalog] = useState<CatalogVoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  // `detail` changes on every save, so fixing a wrong key or region loads the list.
  useEffect(() => {
    if (!isReady) return;
    let isCancelled = false;
    setError(null);
    source
      .load()
      .then((voices) => !isCancelled && setCatalog(voices))
      .catch((e) => !isCancelled && setError(errorMessage(e)));
    return () => {
      isCancelled = true;
    };
  }, [detail, source, isReady]);

  if (catalog.length > 0) return <VoiceCatalog voices={catalog} {...field} />;
  return (
    <>
      <SuggestionField label="Voice" value={field.value} suggestions={suggestions} onChange={field.onChange} />
      <p className="muted small">
        {error
          ? `Could not load ${source.name}'s full voice list: ${error}`
          : isReady
            ? `Loading ${source.name}'s full voice list…`
            : source.setupHint}
      </p>
    </>
  );
}

function VoiceCatalog({
  voices,
  value,
  onChange,
  filter: wanted,
  onFilterChange,
}: VoiceFieldProps & { voices: CatalogVoice[] }) {
  const { filter, languages, accents, genders, matching } = narrowVoices(voices, wanted);
  const selected = voices.find((voice) => voice.id === value);
  // The saved voice stays visible even when the filters leave it out.
  const isSelectedFilteredOut = !matching.some((voice) => voice.id === value);

  return (
    <>
      <FilterField
        label="Language"
        value={filter.language}
        options={languages}
        // Accents belong to a language, so the old one may not exist in the new one.
        onChange={(language) => onFilterChange({ ...filter, language, accent: ANY })}
      />
      <FilterField
        label="Accent"
        value={filter.accent}
        options={accents}
        onChange={(accent) => onFilterChange({ ...filter, accent })}
      />
      <FilterField
        label="Gender"
        value={filter.gender}
        options={genders}
        onChange={(gender) => onFilterChange({ ...filter, gender })}
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

/** Hidden when it has a single choice, which narrows nothing: Azure has no accent finer than the language. */
function FilterField({ label, value, options, onChange }: FilterFieldProps) {
  if (options.length < 2) return null;
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
