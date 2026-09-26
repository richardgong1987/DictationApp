import { useCallback, useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api, errorMessage, onAudioProgress } from "../api";
import type { GenerationSummary, LessonDetail } from "../types";
import { MAX_RECOMMENDED_WORDS } from "../types";
import type { View } from "../App";
import { formatPercent } from "../format";
import AudioBadge from "../components/AudioBadge";
import ErrorBanner from "../components/ErrorBanner";

interface Props {
  lessonId: string;
  autoGenerate: boolean;
  navigate: (v: View) => void;
}

export default function LessonDetailScreen({ lessonId, autoGenerate, navigate }: Props) {
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<GenerationSummary | null>(null);
  const [busyItems, setBusyItems] = useState<Set<number>>(new Set());
  const autoStarted = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setDetail(await api.getLesson(lessonId));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [lessonId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live per-item status updates while the whole lesson is generated.
  useEffect(() => {
    const unlisten = onAudioProgress((p) => {
      if (p.lessonId !== lessonId) return;
      setProgress({ done: p.done, total: p.total });
      setDetail((d) =>
        d && {
          ...d,
          items: d.items.map((i) => (i.id === p.itemId ? { ...i, audioStatus: p.audioStatus } : i)),
        },
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [lessonId]);

  const generateAll = useCallback(
    async (force: boolean) => {
      setError(null);
      setSummary(null);
      setProgress({ done: 0, total: 0 });
      try {
        setSummary(await api.generateLessonAudio(lessonId, force));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setProgress(null);
        refresh();
      }
    },
    [lessonId, refresh],
  );

  useEffect(() => {
    if (!autoGenerate || autoStarted.current || !detail) return;
    autoStarted.current = true;
    if (detail.items.some((i) => i.audioStatus !== "ready")) generateAll(false);
  }, [autoGenerate, detail, generateAll]);

  async function regenerateAll() {
    const confirmed = await ask(
      "Regenerate audio for every item? This calls Azure once per item.",
      { title: "Regenerate all audio", okLabel: "Regenerate", cancelLabel: "Cancel" },
    );
    if (confirmed) generateAll(true);
  }

  async function regenerateItem(itemId: number) {
    setError(null);
    setBusyItems((s) => new Set(s).add(itemId));
    try {
      const updated = await api.generateItemAudio(itemId, true);
      setDetail((d) => d && { ...d, items: d.items.map((i) => (i.id === itemId ? updated : i)) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyItems((s) => {
        const next = new Set(s);
        next.delete(itemId);
        return next;
      });
    }
  }

  if (!detail) {
    return (
      <main className="page">
        <button className="link" onClick={() => navigate({ name: "library" })}>
          ← Lessons
        </button>
        <ErrorBanner message={error} />
        {!error && <p className="muted">Loading…</p>}
      </main>
    );
  }

  const { lesson, items } = detail;
  const readyCount = items.filter((i) => i.audioStatus === "ready").length;
  const longCount = items.filter((i) => i.tooLong).length;
  const generating = progress !== null;
  const self: View = { name: "lesson", lessonId };

  return (
    <main className="page">
      <button className="link" onClick={() => navigate({ name: "library" })}>
        ← Lessons
      </button>
      <header className="topbar">
        <div>
          <h1>{lesson.title}</h1>
          <div className="muted small">
            {items.length} items · audio {readyCount}/{items.length} ready
          </div>
        </div>
        <div className="actions">
          <button onClick={() => navigate({ name: "settings", back: self })}>Settings</button>
          <button
            onClick={() => generateAll(false)}
            disabled={generating || readyCount === items.length}
          >
            Generate missing audio
          </button>
          <button onClick={regenerateAll} disabled={generating}>
            Regenerate all
          </button>
          <button
            className="primary"
            onClick={() => navigate({ name: "practice", lessonId, startIndex: 0 })}
          >
            Start practice
          </button>
        </div>
      </header>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {generating && (
        <div className="banner info">
          Generating audio… {progress.total > 0 ? `${progress.done} / ${progress.total}` : ""}
          <progress value={progress.done} max={Math.max(progress.total, 1)} />
        </div>
      )}

      {summary && !generating && (
        <div className={`banner ${summary.failed > 0 ? "error" : "success"}`}>
          <div>
            Audio: {summary.generated} generated, {summary.cached} already cached
            {summary.failed > 0 && `, ${summary.failed} failed`}.
          </div>
          {summary.errors.slice(0, 3).map((e) => (
            <div key={e} className="small">
              {e}
            </div>
          ))}
        </div>
      )}

      {longCount > 0 && (
        <div className="banner warn">
          {longCount} {longCount === 1 ? "passage is" : "passages are"} longer than{" "}
          {MAX_RECOMMENDED_WORDS} words. Shorter passages are easier to practice.
        </div>
      )}

      <ol className="item-list">
        {items.map((item, index) => (
          <li key={item.id} className="card item-row">
            <span className="item-pos">{item.position}</span>
            <div className="item-body">
              <div className="item-text">{item.text}</div>
              <div className="muted small item-meta">
                <span className={item.tooLong ? "warn-text" : undefined}>
                  {item.wordCount} words{item.tooLong && " — over 30"}
                </span>
                <AudioBadge status={item.audioStatus} busy={busyItems.has(item.id)} />
                {item.attemptCount > 0 && (
                  <span>
                    {item.attemptCount} attempts · best {formatPercent(item.bestAccuracy)}
                  </span>
                )}
              </div>
            </div>
            <div className="actions">
              <button
                onClick={() => regenerateItem(item.id)}
                disabled={generating || busyItems.has(item.id)}
                title="Call Azure again for this item"
              >
                Regenerate
              </button>
              <button
                onClick={() => navigate({ name: "practice", lessonId, startIndex: index })}
                title="Practice from this item"
              >
                ▶
              </button>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
