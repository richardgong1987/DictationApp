import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../api/client";
import type { Settings, SettingsDetail, TtsProvider } from "../../api/types";
import ErrorBanner from "../../components/ErrorBanner";
import PageHeader from "../../components/PageHeader";
import { formatTtsProvider } from "../../format";
import { PROVIDER_FIELDS, type ProviderFieldsProps } from "./ProviderFields";

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
    <main className="page">
      <PageHeader>
        <button className="link" onClick={onClose}>
          ← Back
        </button>
        <h1>Settings</h1>
      </PageHeader>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {form && detail && (
        <form onSubmit={save} className="settings">
          <fieldset>
            <legend>Text-to-speech</legend>
            <label>
              Provider
              <select
                value={form.ttsProvider}
                onChange={(e) => update("ttsProvider", e.target.value as TtsProvider)}
              >
                {(Object.keys(PROVIDER_FIELDS) as TtsProvider[]).map((provider) => (
                  <option key={provider} value={provider}>
                    {formatTtsProvider(provider)}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">
              New audio is generated with this provider and voice, at normal speed; slow it down
              with the player's Speed. Audio you already have is kept, whichever provider made it,
              until you regenerate it.
            </p>
          </fieldset>

          <SelectedProviderFields form={form} detail={detail} update={update} />

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

function SelectedProviderFields(props: ProviderFieldsProps) {
  const Fields = PROVIDER_FIELDS[props.form.ttsProvider];
  return <Fields {...props} />;
}
