import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { api, errorMessage } from "../api";
import type { CheckResult, ItemView, Lesson, LessonDetail } from "../types";
import { PLAYBACK_SPEEDS } from "../types";
import type { View } from "../App";
import { usePlayer } from "../hooks/usePlayer";
import { formatPercent, formatSpeed, formatTime } from "../format";
import DiffView from "../components/DiffView";
import ErrorBanner from "../components/ErrorBanner";

interface Props {
  lessonId: string;
  startIndex: number;
  navigate: (v: View) => void;
}

/** Loads the lesson and player preferences, then renders the practice screen. */
export default function Practice({ lessonId, startIndex, navigate }: Props) {
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [prefs, setPrefs] = useState<{ speed: number; loop: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getLesson(lessonId), api.getSettings()])
      .then(([d, s]) => {
        setDetail(d);
        setPrefs({ speed: s.settings.playbackSpeed, loop: s.settings.loopEnabled });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [lessonId]);

  if (!detail || !prefs) {
    return (
      <main className="page">
        <button className="link" onClick={() => navigate({ name: "lesson", lessonId })}>
          ← Lesson
        </button>
        <ErrorBanner message={error} />
        {!error && <p className="muted">Loading…</p>}
      </main>
    );
  }
  if (detail.items.length === 0) {
    return (
      <main className="page">
        <p>This lesson has no items.</p>
      </main>
    );
  }
  return (
    <PracticeSession
      lesson={detail.lesson}
      initialItems={detail.items}
      startIndex={Math.min(Math.max(startIndex, 0), detail.items.length - 1)}
      initialSpeed={prefs.speed}
      initialLoop={prefs.loop}
      navigate={navigate}
    />
  );
}

interface SessionProps {
  lesson: Lesson;
  initialItems: ItemView[];
  startIndex: number;
  initialSpeed: number;
  initialLoop: boolean;
  navigate: (v: View) => void;
}

/** Keeps a button from taking keyboard focus when clicked. */
const noFocus = (e: MouseEvent) => e.preventDefault();

function PracticeSession({
  lesson,
  initialItems,
  startIndex,
  initialSpeed,
  initialLoop,
  navigate,
}: SessionProps) {
  const [items, setItems] = useState(initialItems);
  const [index, setIndex] = useState(startIndex);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [replayCount, setReplayCount] = useState(0);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionScores, setSessionScores] = useState<Map<number, number>>(new Map());
  const [reloadKey, setReloadKey] = useState(0);

  const player = usePlayer(initialSpeed, initialLoop);
  const { state } = player;
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // ---- audio loading -------------------------------------------------------

  /** Blob URLs per item, shared between current playback and prefetching. */
  const audioUrls = useRef(new Map<number, Promise<string>>());
  const loadToken = useRef(0);
  const navigatingOutsideAnswer = useRef(false);

  useEffect(() => {
    const urls = audioUrls.current;
    return () => {
      for (const p of urls.values()) p.then(URL.revokeObjectURL, () => undefined);
      urls.clear();
    };
  }, []);

  const updateItem = useCallback((updated: ItemView) => {
    setItems((list) => list.map((i) => (i.id === updated.id ? updated : i)));
  }, []);

  const audioUrl = useCallback(
    (item: ItemView): Promise<string> => {
      const existing = audioUrls.current.get(item.id);
      if (existing) return existing;
      const promise = (async () => {
        if (item.audioStatus !== "ready") {
          // Generates only when needed; cached audio never calls Azure.
          try {
            updateItem(await api.generateItemAudio(item.id, false));
          } catch (e) {
            // Audio made with an older voice is still worth playing.
            if (item.audioStatus === "missing") throw e;
          }
        }
        const bytes = await api.getItemAudio(item.id);
        return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      })();
      audioUrls.current.set(item.id, promise);
      promise.catch(() => audioUrls.current.delete(item.id));
      return promise;
    },
    [updateItem],
  );

  const item = items[index];

  useEffect(() => {
    const current = itemsRef.current[index];
    const token = ++loadToken.current;
    setAnswer("");
    setResult(null);
    setReplayCount(0);
    setAudioError(null);
    setAudioLoading(true);
    player.load(null, false);
    // Focus the answer box for the next item, unless the user is navigating
    // with plain shortcuts outside it.
    if (!navigatingOutsideAnswer.current) answerRef.current?.focus();
    navigatingOutsideAnswer.current = false;

    audioUrl(current)
      .then((url) => {
        if (token !== loadToken.current) return;
        player.load(url, true);
        setAudioLoading(false);
        const next = itemsRef.current[index + 1];
        if (next && next.audioStatus === "ready") audioUrl(next).catch(() => undefined);
      })
      .catch((e) => {
        if (token !== loadToken.current) return;
        setAudioLoading(false);
        setAudioError(errorMessage(e));
      });
    // Player functions are stable; reloadKey retries a failed load.
  }, [index, reloadKey, audioUrl]);

  // ---- player preferences --------------------------------------------------

  const prefsLoaded = useRef(false);
  useEffect(() => {
    if (!prefsLoaded.current) {
      prefsLoaded.current = true;
      return;
    }
    api.savePlayerPreferences(state.speed, state.loop).catch(() => undefined);
  }, [state.speed, state.loop]);

  // ---- actions -------------------------------------------------------------

  const togglePlay = () => {
    if (player.toggle()) setReplayCount((c) => c + 1);
  };
  const replay = () => {
    player.replay();
    setReplayCount((c) => c + 1);
  };
  const goTo = (i: number) => {
    if (i >= 0 && i < items.length && i !== index) setIndex(i);
  };
  const changeSpeed = (delta: number) => {
    const current = PLAYBACK_SPEEDS.findIndex((s) => Math.abs(s - state.speed) < 1e-6);
    const next = Math.min(Math.max((current < 0 ? 3 : current) + delta, 0), PLAYBACK_SPEEDS.length - 1);
    player.setSpeed(PLAYBACK_SPEEDS[next]);
  };
  const toggleLoop = () => player.setLoop(!state.loop);

  const checkAnswer = async () => {
    if (checking || result) return;
    setChecking(true);
    setError(null);
    try {
      const r = await api.checkAnswer(item.id, answer, replayCount);
      setResult(r);
      setSessionScores((m) => new Map(m).set(item.id, r.accuracy));
      updateItem({
        ...item,
        attemptCount: item.attemptCount + 1,
        lastAccuracy: r.accuracy,
        bestAccuracy: Math.max(item.bestAccuracy ?? 0, r.accuracy),
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const tryAgain = () => {
    setResult(null);
    setAnswer("");
    answerRef.current?.focus();
  };

  const isLast = index === items.length - 1;
  const finish = () => navigate({ name: "lesson", lessonId: lesson.id });

  /** Enter: check the answer, or move on once it has been checked. */
  const enter = () => {
    if (!result) checkAnswer();
    else if (!isLast) goTo(index + 1);
  };

  // ---- keyboard ------------------------------------------------------------

  const actions = useRef({ togglePlay, replay, goTo, index, changeSpeed, toggleLoop, enter });
  actions.current = { togglePlay, replay, goTo, index, changeSpeed, toggleLoop, enter };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && !["range", "checkbox", "button"].includes(target.type));
      const mod = e.ctrlKey || e.metaKey;
      const a = actions.current;

      if (e.key === "Enter") {
        if (e.shiftKey || target instanceof HTMLButtonElement) return; // newline / press button
        e.preventDefault();
        a.enter();
        return;
      }
      if (e.key === "Escape" && typing) {
        target.blur();
        return;
      }
      // While typing an answer, only modifier shortcuts control the player.
      if (typing && !mod) return;

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === " " && target instanceof HTMLButtonElement) return;
      let action: (() => void) | null = null;
      switch (key) {
        case " ":
          action = a.togglePlay;
          break;
        case "r":
          action = a.replay;
          break;
        case "l":
          action = a.toggleLoop;
          break;
        case "ArrowLeft":
          action = () => a.goTo(a.index - 1);
          break;
        case "ArrowRight":
          action = () => a.goTo(a.index + 1);
          break;
        case "ArrowUp":
          action = () => a.changeSpeed(1);
          break;
        case "ArrowDown":
          action = () => a.changeSpeed(-1);
          break;
      }
      if (!action) return;
      e.preventDefault();
      if (!typing) navigatingOutsideAnswer.current = true;
      if (!e.repeat || key.startsWith("Arrow")) action();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---- render --------------------------------------------------------------

  const scores = [...sessionScores.values()];
  const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const duration = state.duration;

  return (
    <main className="page practice">
      <header className="topbar">
        <button className="link" onClick={finish}>
          ← {lesson.title}
        </button>
        <div className="counter">
          {index + 1} / {items.length}
        </div>
      </header>
      <div className="muted small session">
        Checked {scores.length} this session
        {average !== null && ` · average ${formatPercent(average)}`}
        {item.attemptCount > 0 && ` · this item best ${formatPercent(item.bestAccuracy)}`}
      </div>

      <section className="card player" aria-label="Audio player">
        <div className="timeline">
          <span className="time">{formatTime(state.currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.05}
            value={Math.min(state.currentTime, duration || 0)}
            onChange={(e) => player.seek(Number(e.target.value))}
            disabled={!state.ready}
            aria-label="Seek"
          />
          <span className="time">{formatTime(duration)}</span>
        </div>

        <div className="controls">
          <button onMouseDown={noFocus} onClick={() => goTo(index - 1)} disabled={index === 0} title="Previous (←)">
            ⏮ Prev
          </button>
          <button onMouseDown={noFocus} onClick={replay} disabled={!state.ready} title="Replay (R)">
            ↺ Replay
          </button>
          <button
            onMouseDown={noFocus}
            className="primary play"
            onClick={togglePlay}
            disabled={!state.ready}
            title="Play / Pause (Space)"
          >
            {audioLoading ? "Loading…" : state.playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button onMouseDown={noFocus} onClick={() => goTo(index + 1)} disabled={isLast} title="Next (→)">
            Next ⏭
          </button>
        </div>

        <div className="controls secondary">
          <button
            onMouseDown={noFocus}
            className={state.loop ? "toggle on" : "toggle"}
            onClick={toggleLoop}
            aria-pressed={state.loop}
            title="Loop current item (L)"
          >
            ⟳ Loop {state.loop ? "on" : "off"}
          </button>
          <label className="speed" title="Playback speed (↑ / ↓)">
            Speed
            <select
              value={state.speed}
              onChange={(e) => player.setSpeed(Number(e.target.value))}
            >
              {PLAYBACK_SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {formatSpeed(s)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {audioError && (
          <div className="banner error">
            <span>{audioError}</span>
            <button onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
          </div>
        )}
      </section>

      <section className="answer">
        <label htmlFor="answer">Type what you hear:</label>
        <textarea
          id="answer"
          ref={answerRef}
          rows={3}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          readOnly={result !== null}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          placeholder="Listen, then type the passage here…"
        />
        <div className="actions center">
          {!result ? (
            <button className="primary" onClick={checkAnswer} disabled={checking}>
              Check Answer
            </button>
          ) : (
            <>
              <button onClick={tryAgain}>Try again</button>
              {isLast ? (
                <button className="primary" onClick={finish}>
                  Finish lesson
                </button>
              ) : (
                <button className="primary" onClick={() => goTo(index + 1)}>
                  Next item →
                </button>
              )}
            </>
          )}
        </div>
      </section>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {result && (
        <section className={`card result ${result.isCorrect ? "correct" : ""}`}>
          <div className="score">
            {result.isCorrect ? (
              <strong>✓ Correct</strong>
            ) : (
              <strong>
                {result.correctWords} / {result.sourceWords} words · {formatPercent(result.accuracy)}
              </strong>
            )}
            {replayCount > 0 && <span className="muted small"> · {replayCount} replays</span>}
          </div>
          <dl>
            <dt>Original</dt>
            <dd className="source">{result.sourceText}</dd>
            <dt>Your answer</dt>
            <dd>{result.answer || <span className="muted">(empty)</span>}</dd>
            {!result.isCorrect && (
              <>
                <dt>Differences</dt>
                <dd>
                  <DiffView diff={result.diff} />
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      <details className="shortcuts muted small">
        <summary>Keyboard shortcuts</summary>
        <p>
          Outside the answer box: <kbd>Space</kbd> play/pause · <kbd>R</kbd> replay · <kbd>←</kbd>/
          <kbd>→</kbd> previous/next · <kbd>L</kbd> loop · <kbd>↑</kbd>/<kbd>↓</kbd> speed ·{" "}
          <kbd>Enter</kbd> check answer / next item.
        </p>
        <p>
          While typing: hold <kbd>Ctrl</kbd> (<kbd>⌘</kbd> on macOS) with the same keys, e.g.{" "}
          <kbd>Ctrl</kbd>+<kbd>Space</kbd> or <kbd>Ctrl</kbd>+<kbd>R</kbd>. <kbd>Enter</kbd> checks,{" "}
          <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line break, <kbd>Esc</kbd> leaves the answer box.
        </p>
      </details>
    </main>
  );
}
