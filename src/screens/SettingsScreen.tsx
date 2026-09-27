import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../api/client";
import type { Settings, SettingsDetail } from "../api/types";
import ErrorBanner from "../components/ErrorBanner";
import { formatSignedPercent } from "../format";

/** Suggestions only; any Azure neural voice name can be typed in. */
const COMMON_VOICES = [
  "en-US-JennyNeural",
  "en-US-GuyNeural",
  "en-US-AriaNeural",
  "en-US-DavisNeural",
  "en-GB-SoniaNeural",
  "en-GB-RyanNeural",
  "en-AU-NatashaNeural",
  "en-AU-WilliamNeural",
];

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
    <main className="page narrow">
      <button className="link" onClick={onClose}>
        ← Back
      </button>
      <h1>Settings</h1>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {form && detail && (
        <form onSubmit={save} className="settings">
          <fieldset>
            <legend>Azure Speech</legend>
            <p className={`banner ${detail.credentialsConfigured ? "success" : "info"}`}>
              {detail.credentialsConfigured
                ? "Credentials are configured."
                : "Enter your Azure Speech key and region to generate audio."}
            </p>
            <label>
              Region
              <input
                value={detail.regionFromEnv ? "" : form.azureRegion}
                placeholder={detail.regionFromEnv ? "Set by AZURE_SPEECH_REGION" : "e.g. eastus"}
                disabled={detail.regionFromEnv}
                onChange={(e) => update("azureRegion", e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              Key
              <input
                type="password"
                value={detail.keyFromEnv ? "" : form.azureKey}
                placeholder={detail.keyFromEnv ? "Set by AZURE_SPEECH_KEY" : "Azure Speech resource key"}
                disabled={detail.keyFromEnv}
                onChange={(e) => update("azureKey", e.target.value)}
                autoComplete="off"
              />
            </label>
            <p className="muted small">
              Environment variables <code>AZURE_SPEECH_KEY</code> / <code>AZURE_SPEECH_REGION</code>{" "}
              take precedence. A key entered here is stored unencrypted in the app's local data
              folder on this computer.
            </p>
          </fieldset>

          <fieldset>
            <legend>Voice</legend>
            <label>
              Voice name
              <input
                list="voices"
                value={form.voice}
                onChange={(e) => update("voice", e.target.value)}
                spellCheck={false}
              />
              <datalist id="voices">
                {COMMON_VOICES.map((voice) => (
                  <option key={voice} value={voice} />
                ))}
              </datalist>
            </label>
            <label>
              Speaking rate: {formatSignedPercent(form.speakingRate)}
              <input
                type="range"
                min={-50}
                max={100}
                step={5}
                value={form.speakingRate}
                onChange={(e) => update("speakingRate", Number(e.target.value))}
              />
            </label>
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
            <p className="muted small">
              Changing the voice, rate or pitch marks existing audio as outdated. It is regenerated
              the next time you generate a lesson's audio or practice an item.
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
