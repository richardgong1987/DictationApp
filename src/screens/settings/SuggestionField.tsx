import type { ChangeEvent } from "react";

/** The "type your own" choice. An empty value cannot be a real ID. */
const OTHER = "";

interface SuggestionFieldProps {
  label: string;
  value: string;
  suggestions: { id: string; label: string }[];
  onChange: (value: string) => void;
}

/**
 * A list of suggestions that also takes any other value. A real list rather
 * than a `datalist`, which filters by the current value and so shows nothing
 * once a field is filled in.
 */
export default function SuggestionField({
  label,
  value,
  suggestions,
  onChange,
}: SuggestionFieldProps) {
  const isSuggested = suggestions.some((suggestion) => suggestion.id === value);
  const change = (e: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => onChange(e.target.value);
  return (
    <label>
      {label}
      <select value={isSuggested ? value : OTHER} onChange={change}>
        {suggestions.map((suggestion) => (
          <option key={suggestion.id} value={suggestion.id}>
            {suggestion.label}
          </option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>
      {!isSuggested && (
        <input
          aria-label={`Other ${label}`}
          value={value}
          onChange={change}
          autoComplete="off"
          spellCheck={false}
        />
      )}
    </label>
  );
}
