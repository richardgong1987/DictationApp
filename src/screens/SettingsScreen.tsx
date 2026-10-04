import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../api/client";
import { SPEAKING_RATE_RANGE } from "../api/constants";
import type { Settings, SettingsDetail, TtsProvider } from "../api/types";
import ErrorBanner from "../components/ErrorBanner";
import { formatSignedPercent, formatTtsProvider } from "../format";

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

type UpdateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

interface ProviderFieldsProps {
  form: Settings;
  detail: SettingsDetail;
  update: UpdateSetting;
}

export default function SettingsScreen({ onClose }: { onClose: () => void }) {
  const [detail, setDetail] = useState<SettingsDetail | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((loaded) => {
        setDetail(loaded);
        setForm(loaded.settings);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setIsSaved(false);
    setForm((f) => f && { ...f, [key]: value });
  };

  /** Keeps the speaking rate within what the new provider supports. */
  function changeProvider(ttsProvider: TtsProvider) {
    const { min, max } = SPEAKING_RATE_RANGE[ttsProvider];
    setIsSaved(false);
    setForm(
      (f) => f && { ...f, ttsProvider, speakingRate: Math.min(max, Math.max(min, f.speakingRate)) },
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await api.saveSettings(form);
      setDetail(saved);
      setForm(saved.settings);
      setIsSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="page">
      <button className="link" onClick={onClose}>
        ← Back
      </button>
      <h1>Settings</h1>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {form && detail && (
        <form onSubmit={save} className="settings">
          <fieldset>
            <legend>Text-to-speech</legend>
            <label>
              Provider
              <select
                value={form.ttsProvider}
                onChange={(e) => changeProvider(e.target.value as TtsProvider)}
              >
                <option value="azure">{formatTtsProvider("azure")}</option>
                <option value="elevenlabs">{formatTtsProvider("elevenlabs")}</option>
              </select>
            </label>
            <p className="muted small">
              New audio is generated with this provider. Audio you already have keeps playing until
              it is regenerated.
            </p>
          </fieldset>

          {form.ttsProvider === "azure" ? (
            <AzureFields form={form} detail={detail} update={update} />
          ) : (
            <ElevenLabsFields form={form} detail={detail} update={update} />
          )}

          <fieldset>
            <legend>Speech</legend>
            <label>
              Speaking rate: {formatSignedPercent(form.speakingRate)}
              <input
                type="range"
                min={SPEAKING_RATE_RANGE[form.ttsProvider].min}
                max={SPEAKING_RATE_RANGE[form.ttsProvider].max}
                step={5}
                value={form.speakingRate}
                onChange={(e) => update("speakingRate", Number(e.target.value))}
              />
            </label>
            {form.ttsProvider === "azure" && (
              <label>
                Pitch: {formatSignedPercent(form.pitch)}
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={5}
                  value={form.pitch}
                  onChange={(e) => update("pitch", Number(e.target.value))}
                />
              </label>
            )}
            <p className="muted small">
              Changing the provider, voice, rate or pitch marks existing audio as outdated. It is
              regenerated the next time you generate a lesson's audio or practice an item.
            </p>
          </fieldset>

          <div className="actions">
            <button type="submit" className="primary" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </button>
            {isSaved && <span className="success-text">Saved.</span>}
          </div>
        </form>
      )}
    </main>
  );
}

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
      <p className={`banner ${detail.elevenlabsConfigured ? "success" : "info"}`}>
        {detail.elevenlabsConfigured
          ? "API key is configured."
          : "Enter your ElevenLabs API key to generate audio."}
      </p>
      <label>
        API key
        <input
          type="password"
          value={detail.elevenlabsKeyFromEnv ? "" : form.elevenlabsKey}
          placeholder={detail.elevenlabsKeyFromEnv ? "Set by ELEVENLABS_API_KEY" : "ElevenLabs API key"}
          disabled={detail.elevenlabsKeyFromEnv}
          onChange={(e) => update("elevenlabsKey", e.target.value)}
          autoComplete="off"
        />
      </label>
      <p className="muted small">
        The environment variable <code>ELEVENLABS_API_KEY</code> takes precedence. A key entered
        here is stored unencrypted in the app's local data folder on this computer.
      </p>
      <label>
        Voice ID
        <input
          list="elevenlabs-voices"
          value={form.elevenlabsVoiceId}
          onChange={(e) => update("elevenlabsVoiceId", e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <datalist id="elevenlabs-voices">
          {ELEVENLABS_VOICES.map(({ id, label }) => (
            <option key={id} value={id} label={label} />
          ))}
        </datalist>
      </label>
      <p className="muted small">
        Copy the ID of any voice from your voice library on elevenlabs.io.
      </p>
      <label>
        Model
        <input
          list="elevenlabs-models"
          value={form.elevenlabsModel}
          onChange={(e) => update("elevenlabsModel", e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <datalist id="elevenlabs-models">
          {ELEVENLABS_MODELS.map(({ id, label }) => (
            <option key={id} value={id} label={label} />
          ))}
        </datalist>
      </label>
    </fieldset>
  );
}
