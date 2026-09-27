import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { ItemDetail, Lesson } from "../../api/types";
import type { Navigate } from "../../navigation";
import { formatPercent } from "../../format";
import PlayerPanel, { type PlayerCommands } from "./PlayerPanel";
import PracticeItemCard from "./PracticeItemCard";
import ShortcutHelp from "./ShortcutHelp";
import { useAudioPlayer, type PlayerPreferences } from "./useAudioPlayer";
import { useItemAudio } from "./useItemAudio";
import { needsCheck, usePracticeProgress } from "./usePracticeProgress";
import { usePracticeShortcuts, type PracticeCommands } from "./usePracticeShortcuts";

interface Props {
  lesson: Lesson;
  initialItems: ItemDetail[];
  startIndex: number;
  preferences: PlayerPreferences;
  navigate: Navigate;
}

/**
 * Every item of the lesson as one card. One of them is the current item: it
 * is loaded in the shared player, and the keyboard shortcuts act on it.
 */
export default function PracticeSession({
  lesson,
  initialItems,
  startIndex,
  preferences,
  navigate,
}: Props) {
  const [items, setItems] = useState(initialItems);
  const [index, setIndex] = useState(startIndex);
  const [checkingItemId, setCheckingItemId] = useState<number | null>(null);
  const [checkError, setCheckError] = useState<{ itemId: number; message: string } | null>(null);
  const progress = usePracticeProgress();
  const answerBoxes = useRef(new Map<number, HTMLTextAreaElement>());
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

  const activeItem = items[index];
  const isLast = index === items.length - 1;

  useEffect(() => {
    if (!keepFocusOutsideAnswer.current) answerBoxes.current.get(activeItem.id)?.focus();
    keepFocusOutsideAnswer.current = false;
  }, [activeItem.id]);

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

  /** Shows the original text; the answer is checked first unless unchanged since the last check. */
  const reveal = async (item: ItemDetail) => {
    const itemProgress = progress.progressOf(item.id);
    if (!needsCheck(itemProgress)) {
      progress.setRevealed(item.id, true);
      return;
    }
    if (checkingItemId !== null) return;
    setCheckingItemId(item.id);
    setCheckError(null);
    try {
      const checked = await api.checkAnswer(item.id, itemProgress.answer, itemProgress.replayCount);
      progress.recordCheck(item.id, itemProgress.answer, checked);
      setItems((list) =>
        list.map((i) =>
          i.id === item.id
            ? {
                ...i,
                attemptCount: i.attemptCount + 1,
                lastAccuracy: checked.accuracy,
                bestAccuracy: Math.max(i.bestAccuracy ?? 0, checked.accuracy),
              }
            : i,
        ),
      );
    } catch (e) {
      setCheckError({ itemId: item.id, message: errorMessage(e) });
    } finally {
      setCheckingItemId(null);
    }
  };

  const hide = (item: ItemDetail) => {
    progress.setRevealed(item.id, false);
    if (item.id === activeItem.id) answerBoxes.current.get(item.id)?.focus();
  };

  const commands: PracticeCommands = {
    togglePlay: () => {
      if (player.toggle()) progress.countReplay(activeItem.id);
    },
    replay: () => {
      player.replay();
      progress.countReplay(activeItem.id);
    },
    toggleLoop: player.toggleLoop,
    previous: () => goTo(index - 1),
    next: () => goTo(index + 1),
    faster: () => player.stepSpeed(1),
    slower: () => player.stepSpeed(-1),
    // Enter reveals (and checks) the current item, then moves on to the next one.
    submit: () => {
      if (!progress.progressOf(activeItem.id).isRevealed) reveal(activeItem);
      else if (!isLast) goTo(index + 1);
    },
  };

  usePracticeShortcuts((command, { isTyping }) => {
    if (!isTyping && command !== "submit") keepFocusOutsideAnswer.current = true;
    commands[command]();
  });

  /** Controls on another card first make that card's item the current one, which plays it. */
  const playerCommandsFor = (rowIndex: number): PlayerCommands =>
    rowIndex === index
      ? commands
      : {
          togglePlay: () => goTo(rowIndex),
          replay: () => goTo(rowIndex),
          previous: () => goTo(rowIndex - 1),
          next: () => goTo(rowIndex + 1),
          toggleLoop: player.toggleLoop,
        };

  /** Ref callback that keeps `answerBoxes` in step as answer boxes mount and unmount. */
  const registerAnswerBox = (itemId: number) => (textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    answerBoxes.current.set(itemId, textarea);
    return () => {
      answerBoxes.current.delete(itemId);
    };
  };

  const scores = progress.results.map((result) => result.accuracy);
  const averageScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  return (
    <main className="page practice">
      <header className="topbar">
        <button
          className="link"
          onClick={() => navigate({ name: "lesson", lessonId: lesson.id })}
        >
          ← {lesson.title}
        </button>
        <div className="practice-status">
          <span className="muted">
            Checked {scores.length} of {items.length}
            {averageScore !== null && ` · average ${formatPercent(averageScore)}`}
          </span>
          <span className="counter">
            {index + 1} / {items.length}
          </span>
        </div>
      </header>

      <ol className="practice-list">
        {items.map((item, rowIndex) => {
          const isActive = rowIndex === index;
          return (
            <PracticeItemCard
              key={item.id}
              item={item}
              progress={progress.progressOf(item.id)}
              isActive={isActive}
              isChecking={checkingItemId === item.id}
              error={checkError?.itemId === item.id ? checkError.message : null}
              answerRef={registerAnswerBox(item.id)}
              playerPanel={
                <PlayerPanel
                  player={player}
                  isActive={isActive}
                  duration={itemAudio.durations.get(item.id)}
                  itemAudio={itemAudio}
                  commands={playerCommandsFor(rowIndex)}
                  hasPrevious={rowIndex > 0}
                  hasNext={rowIndex < items.length - 1}
                />
              }
              actions={{
                changeAnswer: (answer) => progress.setAnswer(item.id, answer),
                reveal: () => reveal(item),
                hide: () => hide(item),
                activate: () => goTo(rowIndex),
                dismissError: () => setCheckError(null),
              }}
            />
          );
        })}
      </ol>

      <ShortcutHelp />
    </main>
  );
}
