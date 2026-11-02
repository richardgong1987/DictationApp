// The Settings fields of each text-to-speech provider.

import { useId, type ReactElement } from "react";
import type { Settings, SettingsDetail, TtsProvider } from "../../api/types";

/** Suggestions only; any Azure neural voice name can be typed in. */
const AZURE_VOICES = [
  "en-US-JennyNeural",
  "en-US-GuyNeural",
  "en-US-AriaNeural",
  "en-US-DavisNeural",
  "en-GB-SoniaNeural",
  "en-GB-RyanNeural",
  "en-AU-NatashaNeural",
  "en-AU-WilliamNeural",
];

/** Suggestions only; any voice ID from the ElevenLabs voice library can be pasted in. */
const ELEVENLABS_VOICES = [
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "George (British)" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah (American)" },
];

/** Suggestions only; any ElevenLabs model ID can be typed in. */
const ELEVENLABS_MODELS = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2: lifelike and stable" },
  { id: "eleven_flash_v2_5", label: "Flash v2.5: faster, half the credits" },
  { id: "eleven_v4", label: "v4: most expressive" },
];

/** Suggestions only; any voice from the Gemini voice list can be typed in. */
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

/** Suggestions only; any Gemini text-to-speech model ID can be typed in. */
const GEMINI_MODELS = [
  { id: "gemini-3.8-flash-tts", label: "3.8 Flash TTS: best quality and pronunciation" },
  { id: "gemini-3.8-flash-lite-tts", label: "3.8 Flash-Lite TTS: faster and cheaper" },
];

type UpdateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

export interface ProviderFieldsProps {
  form: Settings;
  detail: SettingsDetail;
  update: UpdateSetting;
}

export const PROVIDER_FIELDS: Record<TtsProvider, (props: ProviderFieldsProps) => ReactElement> = {
  azure: AzureFields,
  elevenlabs: ElevenLabsFields,
  gemini: GeminiFields,
};

function AzureFields({ form, detail, update }: ProviderFieldsProps) {
  return (
    <fieldset>
      <legend>Azure Speech</legend>
      <p className={`banner ${detail.azureConfigured ? "success" : "info"}`}>
        {detail.azureConfigured
          ? "Credentials are configured."
          : "Enter your Azure Speech key and region to generate audio."}
      </p>
      <label>
        Region
        <input
          value={detail.azureRegionFromEnv ? "" : form.azureRegion}
          placeholder={detail.azureRegionFromEnv ? "Set by AZURE_SPEECH_REGION" : "e.g. eastus"}
          disabled={detail.azureRegionFromEnv}
          onChange={(e) => update("azureRegion", e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label>
        Key
        <input
          type="password"
          value={detail.azureKeyFromEnv ? "" : form.azureKey}
          placeholder={detail.azureKeyFromEnv ? "Set by AZURE_SPEECH_KEY" : "Azure Speech resource key"}
          disabled={detail.azureKeyFromEnv}
          onChange={(e) => update("azureKey", e.target.value)}
          autoComplete="off"
        />
      </label>
      <p className="muted small">
        Environment variables <code>AZURE_SPEECH_KEY</code> / <code>AZURE_SPEECH_REGION</code> take
        precedence. A key entered here is stored unencrypted in the app's local data folder on this
        computer.
      </p>
      <label>
        Voice name
        <input
          list="azure-voices"
          value={form.azureVoice}
          onChange={(e) => update("azureVoice", e.target.value)}
          spellCheck={false}
        />
        <datalist id="azure-voices">
          {AZURE_VOICES.map((voice) => (
            <option key={voice} value={voice} />
          ))}
        </datalist>
      </label>
    </fieldset>
  );
}

function ElevenLabsFields({ form, detail, update }: ProviderFieldsProps) {
  return (
    <fieldset>
      <legend>ElevenLabs</legend>
      <ApiKeyField
        provider="ElevenLabs"
        envVariable="ELEVENLABS_API_KEY"
        isConfigured={detail.elevenlabsConfigured}
        isFromEnv={detail.elevenlabsKeyFromEnv}
        value={form.elevenlabsKey}
        onChange={(key) => update("elevenlabsKey", key)}
      />
      <SuggestionField
        label="Voice ID"
        value={form.elevenlabsVoiceId}
        suggestions={ELEVENLABS_VOICES}
        onChange={(voice) => update("elevenlabsVoiceId", voice)}
      />
      <p className="muted small">
        Copy the ID of any voice from your voice library on elevenlabs.io.
      </p>
      <SuggestionField
        label="Model"
        value={form.elevenlabsModel}
        suggestions={ELEVENLABS_MODELS}
        onChange={(model) => update("elevenlabsModel", model)}
      />
    </fieldset>
  );
}

function GeminiFields({ form, detail, update }: ProviderFieldsProps) {
  return (
    <fieldset>
      <legend>Google Gemini</legend>
      <ApiKeyField
        provider="Gemini"
        envVariable="GEMINI_API_KEY"
        isConfigured={detail.geminiConfigured}
        isFromEnv={detail.geminiKeyFromEnv}
        value={form.geminiKey}
        onChange={(key) => update("geminiKey", key)}
      />
      <p className="muted small">
        Create a key in Google AI Studio. On the free tier, Google may use the text you send to
        improve its products, so avoid private material.
      </p>
      <SuggestionField
        label="Voice"
        value={form.geminiVoice}
        suggestions={GEMINI_VOICES}
        onChange={(voice) => update("geminiVoice", voice)}
      />
      <p className="muted small">Gemini detects the language from the text.</p>
      <SuggestionField
        label="Model"
        value={form.geminiModel}
        suggestions={GEMINI_MODELS}
        onChange={(model) => update("geminiModel", model)}
      />
    </fieldset>
  );
}

interface ApiKeyFieldProps {
  provider: string;
  envVariable: string;
  isConfigured: boolean;
  isFromEnv: boolean;
  value: string;
  onChange: (key: string) => void;
}

function ApiKeyField({
  provider,
  envVariable,
  isConfigured,
  isFromEnv,
  value,
  onChange,
}: ApiKeyFieldProps) {
  return (
    <>
      <p className={`banner ${isConfigured ? "success" : "info"}`}>
        {isConfigured ? "API key is configured." : `Enter your ${provider} API key to generate audio.`}
      </p>
      <label>
        API key
        <input
          type="password"
          value={isFromEnv ? "" : value}
          placeholder={isFromEnv ? `Set by ${envVariable}` : `${provider} API key`}
          disabled={isFromEnv}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      </label>
      <p className="muted small">
        The environment variable <code>{envVariable}</code> takes precedence. A key entered here is
        stored unencrypted in the app's local data folder on this computer.
      </p>
    </>
  );
}

interface SuggestionFieldProps {
  label: string;
  value: string;
  suggestions: { id: string; label: string }[];
  onChange: (value: string) => void;
}

function SuggestionField({ label, value, suggestions, onChange }: SuggestionFieldProps) {
  const listId = useId();
  return (
    <label>
      {label}
      <input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <datalist id={listId}>
        {suggestions.map((suggestion) => (
          <option key={suggestion.id} value={suggestion.id} label={suggestion.label} />
        ))}
      </datalist>
    </label>
  );
}
