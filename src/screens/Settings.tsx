import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import type { Settings, SettingsView } from "../types";
import ErrorBanner from "../components/ErrorBanner";

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
  const [view, setView] = useState<SettingsView | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((v) => {
        setView(v);
        setForm(v.settings);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSaved(false);
    setForm((f) => f && { ...f, [key]: value });
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const v = await api.saveSettings(form);
      setView(v);
      setForm(v.settings);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page narrow">
      <button className="link" onClick={onClose}>
        ← Back
      </button>
      <h1>Settings</h1>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {form && view && (
        <form onSubmit={save} className="settings">
          <fieldset>
            <legend>Azure Speech</legend>
            <p className={`banner ${view.credentialsConfigured ? "success" : "info"}`}>
              {view.credentialsConfigured
                ? "Credentials are configured."
                : "Enter your Azure Speech key and region to generate audio."}
            </p>
            <label>
              Region
              <input
                value={view.regionFromEnv ? "" : form.azureRegion}
                placeholder={view.regionFromEnv ? "Set by AZURE_SPEECH_REGION" : "e.g. eastus"}
                disabled={view.regionFromEnv}
                onChange={(e) => update("azureRegion", e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              Key
              <input
                type="password"
                value={view.keyFromEnv ? "" : form.azureKey}
                placeholder={view.keyFromEnv ? "Set by AZURE_SPEECH_KEY" : "Azure Speech resource key"}
                disabled={view.keyFromEnv}
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
                {COMMON_VOICES.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </label>
            <label>
              Speaking rate: {form.speakingRate > 0 ? "+" : ""}
              {form.speakingRate}%
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
              Pitch: {form.pitch > 0 ? "+" : ""}
              {form.pitch}%
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
            <button type="submit" className="primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span className="success-text">Saved.</span>}
          </div>
        </form>
      )}
    </main>
  );
}
