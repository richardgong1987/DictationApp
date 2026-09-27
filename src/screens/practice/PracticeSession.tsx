import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { CheckResult, ItemDetail, Lesson } from "../../api/types";
import type { Navigate } from "../../navigation";
import { formatPercent } from "../../format";
import ErrorBanner from "../../components/ErrorBanner";
import AnswerResult from "./AnswerResult";
import PlayerPanel from "./PlayerPanel";
import ShortcutHelp from "./ShortcutHelp";
import { useAudioPlayer, type PlayerPreferences } from "./useAudioPlayer";
import { useItemAudio } from "./useItemAudio";
import { usePracticeShortcuts, type PracticeCommands } from "./usePracticeShortcuts";

interface Props {
  lesson: Lesson;
  initialItems: ItemDetail[];
  startIndex: number;
  preferences: PlayerPreferences;
  navigate: Navigate;
}

export default function PracticeSession({
  lesson,
  initialItems,
  startIndex,
  preferences,
  navigate,
}: Props) {
  const [items, setItems] = useState(initialItems);
  const [index, setIndex] = useState(startIndex);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [replayCount, setReplayCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Accuracy by item id, for answers checked during this session. */
  const [sessionScores, setSessionScores] = useState<ReadonlyMap<number, number>>(new Map());
  const answerRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Set when the user drives the player with plain shortcuts outside the
   * answer box; the next item then leaves the focus where it is.
   */
  const keepFocusOutsideAnswer = useRef(false);

  const player = useAudioPlayer(preferences);
  const updateItem = useCallback((updated: ItemDetail) => {
    setItems((list) => list.map((i) => (i.id === updated.id ? updated : i)));
  }, []);
  const itemAudio = useItemAudio({ items, index, player, onItemUpdated: updateItem });

  const item = items[index];
  const isLast = index === items.length - 1;

  useEffect(() => {
    setAnswer("");
    setResult(null);
    setReplayCount(0);
    if (!keepFocusOutsideAnswer.current) answerRef.current?.focus();
    keepFocusOutsideAnswer.current = false;
  }, [index]);

  // The initial values came from Settings, so only changes need saving.
  const { speed, isLooping } = player.state;
  const isInitialPreferences = useRef(true);
  useEffect(() => {
    if (isInitialPreferences.current) {
      isInitialPreferences.current = false;
      return;
    }
    api.savePlayerPreferences(speed, isLooping).catch(() => undefined);
  }, [speed, isLooping]);

  const goTo = (target: number) => {
    if (target >= 0 && target < items.length && target !== index) setIndex(target);
  };

  const checkAnswer = async () => {
    if (isChecking || result) return;
    setIsChecking(true);
    setError(null);
    try {
      const checked = await api.checkAnswer(item.id, answer, replayCount);
      setResult(checked);
      setSessionScores((scores) => new Map(scores).set(item.id, checked.accuracy));
      updateItem({
        ...item,
        attemptCount: item.attemptCount + 1,
        lastAccuracy: checked.accuracy,
        bestAccuracy: Math.max(item.bestAccuracy ?? 0, checked.accuracy),
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsChecking(false);
    }
  };

  const tryAgain = () => {
    setResult(null);
    setAnswer("");
    answerRef.current?.focus();
  };

  const finish = () => navigate({ name: "lesson", lessonId: lesson.id });

  const commands: PracticeCommands = {
    togglePlay: () => {
      if (player.toggle()) setReplayCount((count) => count + 1);
    },
    replay: () => {
      player.replay();
      setReplayCount((count) => count + 1);
    },
    toggleLoop: player.toggleLoop,
    previous: () => goTo(index - 1),
    next: () => goTo(index + 1),
    faster: () => player.stepSpeed(1),
    slower: () => player.stepSpeed(-1),
    // Enter checks the answer, then moves on once it has been checked.
    submit: () => {
      if (!result) checkAnswer();
      else if (!isLast) goTo(index + 1);
    },
  };

  usePracticeShortcuts((command, { isTyping }) => {
    if (!isTyping && command !== "submit") keepFocusOutsideAnswer.current = true;
    commands[command]();
  });

  const scores = [...sessionScores.values()];
  const averageScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

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
        {averageScore !== null && ` · average ${formatPercent(averageScore)}`}
        {item.attemptCount > 0 && ` · this item best ${formatPercent(item.bestAccuracy)}`}
      </div>

      <PlayerPanel
        player={player}
        itemAudio={itemAudio}
        commands={commands}
        hasPrevious={index > 0}
        hasNext={!isLast}
      />

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
            <button className="primary" onClick={checkAnswer} disabled={isChecking}>
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
                <button className="primary" onClick={commands.next}>
                  Next item →
                </button>
              )}
            </>
          )}
        </div>
      </section>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {result && <AnswerResult result={result} replayCount={replayCount} />}
      <ShortcutHelp />
    </main>
  );
}
