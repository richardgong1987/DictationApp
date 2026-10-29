import { useState } from "react";
import { documentDir, join } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, errorMessage } from "../../api/client";
import type { ExportSummary, ImportSummary } from "../../api/types";
import ErrorBanner from "../../components/ErrorBanner";
import { formatCount } from "../../format";

const EXPORT_FILE_FILTER = { name: "DictationApp lessons", extensions: ["zip"] };

/**
 * iOS cannot write to the place its save dialog picks, so exports go to the app's own
 * Documents folder instead, which the Files app shows as On My iPhone › DictationApp
 * (`UIFileSharingEnabled` in src-tauri/Info.ios.plist).
 */
const savesExportsInFilesApp = import.meta.env.TAURI_ENV_PLATFORM === "ios";

interface Props {
  hasLessons: boolean;
  /** Lessons or audio were imported. */
  onLibraryChanged: () => void;
}

/** Moves every lesson and its audio to another device in one file, so no audio is generated twice. */
export default function LessonTransfer({ hasLessons, onLibraryChanged }: Props) {
  const [activity, setActivity] = useState<"exporting" | "importing" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Runs one export or import and describes its result; resolves to null if it failed. */
  async function run<T>(
    kind: "exporting" | "importing",
    task: () => Promise<T>,
    describe: (result: T) => string,
  ): Promise<T | null> {
    setError(null);
    setNotice(null);
    setActivity(kind);
    try {
      const result = await task();
      setNotice(describe(result));
      return result;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    } finally {
      setActivity(null);
    }
  }

  async function exportLessons() {
    const fileName = `DictationApp lessons ${new Date().toISOString().slice(0, 10)}.zip`;
    const path = savesExportsInFilesApp
      ? await join(await documentDir(), fileName)
      : await save({ defaultPath: fileName, filters: [EXPORT_FILE_FILTER] });
    if (!path) return;
    await run(
      "exporting",
      () => api.exportLessons(path),
      (summary) => describeExport(summary, path),
    );
  }

  async function importLessons() {
    const path = await open({ multiple: false, directory: false, filters: [EXPORT_FILE_FILTER] });
    if (typeof path !== "string") return;
    const summary = await run("importing", () => api.importLessons(path), describeImport);
    if (summary) onLibraryChanged();
  }

  return (
    <section className="card lesson-transfer">
      <h2>Your other devices</h2>
      <p className="muted small">
        Export every lesson with its audio to one .zip file, then import that .zip as it is on
        your other device, so the audio is not generated and paid for again. Importing only adds
        what that device is missing; nothing on it is replaced.
      </p>
      <div className="actions">
        <button onClick={exportLessons} disabled={activity !== null || !hasLessons}>
          {activity === "exporting" ? "Exporting…" : "Export all lessons"}
        </button>
        <button onClick={importLessons} disabled={activity !== null}>
          {activity === "importing" ? "Importing…" : "Import lessons"}
        </button>
      </div>
      {notice && (
        <div className="banner success" role="status">
          {notice}
        </div>
      )}
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
    </section>
  );
}

function describeExport(summary: ExportSummary, path: string): string {
  const exported = `Exported ${formatCount(summary.lessonCount, "lesson")} with ${formatCount(summary.audioCount, "audio file")}`;
  if (!savesExportsInFilesApp) return `${exported} to ${path}. Import it on your other device.`;
  const fileName = path.split("/").pop();
  return `${exported} to the Files app: On My iPhone › DictationApp › ${fileName}. Send it to your other device from there, for example with AirDrop.`;
}

function describeImport(summary: ImportSummary): string {
  const kept =
    summary.existingLessons > 0
      ? ` Already on this device and kept as they are: ${formatCount(summary.existingLessons, "lesson")}.`
      : "";
  if (summary.addedLessons === 0 && summary.addedAudio === 0) {
    return `Nothing new to import.${kept}`;
  }
  return `Imported ${formatCount(summary.addedLessons, "new lesson")} and ${formatCount(summary.addedAudio, "audio file")}.${kept}`;
}
