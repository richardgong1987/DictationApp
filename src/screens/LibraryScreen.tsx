import { useCallback, useEffect, useState } from "react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { api, errorMessage } from "../api/client";
import { MAX_RECOMMENDED_WORDS } from "../api/constants";
import type { LessonSummary } from "../api/types";
import type { Navigate, Route } from "../navigation";
import ErrorBanner from "../components/ErrorBanner";
import TitleInput from "../components/TitleInput";

const SETTINGS_ROUTE: Route = { name: "settings", back: { name: "library" } };

export default function LibraryScreen({ navigate }: { navigate: Navigate }) {
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null);
  const [credentialsConfigured, setCredentialsConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [renamingLessonId, setRenamingLessonId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, settings] = await Promise.all([api.listLessons(), api.getSettings()]);
      setLessons(list);
      setCredentialsConfigured(settings.credentialsConfigured);
    } catch (e) {
      setError(errorMessage(e));
      setLessons([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function importLesson() {
    setError(null);
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Text lesson", extensions: ["txt"] }],
    });
    if (typeof path !== "string") return;
    setIsImporting(true);
    try {
      const detail = await api.importLesson(path);
      navigate({ name: "lesson", lessonId: detail.lesson.id, autoGenerate: credentialsConfigured });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsImporting(false);
    }
  }

  async function renameLesson(lesson: LessonSummary, title: string) {
    setError(null);
    try {
      const renamed = await api.renameLesson(lesson.id, title);
      setLessons((list) => list && list.map((l) => (l.id === renamed.id ? { ...l, ...renamed } : l)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      // Another lesson may have started renaming while this save was running.
      setRenamingLessonId((id) => (id === lesson.id ? null : id));
    }
  }

  async function deleteLesson(lesson: LessonSummary) {
    const confirmed = await ask(
      `Delete "${lesson.title}" and its audio from this computer? Your original text file is not touched.`,
      { title: "Delete lesson", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" },
    );
    if (!confirmed) return;
    try {
      await api.deleteLesson(lesson.id);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <h1>Lessons</h1>
        <div className="actions">
          <button onClick={() => navigate(SETTINGS_ROUTE)}>Settings</button>
          <button className="primary" onClick={importLesson} disabled={isImporting}>
            {isImporting ? "Importing…" : "Import .txt lesson"}
          </button>
        </div>
      </header>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {!credentialsConfigured && (
        <div className="banner info">
          Azure Speech is not configured yet, so new audio cannot be generated.{" "}
          <button className="link" onClick={() => navigate(SETTINGS_ROUTE)}>
            Open Settings
          </button>
        </div>
      )}

      {lessons === null ? (
        <p className="muted">Loading…</p>
      ) : lessons.length === 0 ? (
        <div className="empty">
          <p>No lessons yet.</p>
          <p className="muted">
            Import a UTF-8 <code>.txt</code> file. Separate passages with a blank line; each
            passage becomes one dictation item.
          </p>
        </div>
      ) : (
        <ul className="lesson-list">
          {lessons.map((lesson) => {
            const isAudioComplete = lesson.audioReadyCount === lesson.itemCount;
            const isRenaming = renamingLessonId === lesson.id;
            return (
              <li key={lesson.id} className="card lesson-card">
                {isRenaming ? (
                  <TitleInput
                    initialTitle={lesson.title}
                    onSave={(title) => renameLesson(lesson, title)}
                    onCancel={() => setRenamingLessonId(null)}
                  />
                ) : (
                  <button
                    className="lesson-title link"
                    onClick={() => navigate({ name: "lesson", lessonId: lesson.id })}
                  >
                    {lesson.title}
                  </button>
                )}
                <div className="muted small">
                  {lesson.itemCount} items · audio {lesson.audioReadyCount}/{lesson.itemCount}
                  {lesson.longItemCount > 0 && (
                    <span className="warn-text">
                      {" "}
                      · {lesson.longItemCount} over {MAX_RECOMMENDED_WORDS} words
                    </span>
                  )}
                </div>
                <div className="actions">
                  {!isAudioComplete && (
                    <button
                      onClick={() =>
                        navigate({ name: "lesson", lessonId: lesson.id, autoGenerate: true })
                      }
                    >
                      Generate missing audio
                    </button>
                  )}
                  <button onClick={() => setRenamingLessonId(lesson.id)} disabled={isRenaming}>
                    Rename
                  </button>
                  <button onClick={() => deleteLesson(lesson)}>Delete</button>
                  <button
                    className="primary"
                    onClick={() => navigate({ name: "practice", lessonId: lesson.id })}
                    title="Continue where you stopped last time"
                  >
                    Practice
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
