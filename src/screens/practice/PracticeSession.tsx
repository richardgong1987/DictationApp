import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { ItemDetail, Lesson, SavedAnswer } from "../../api/types";
import type { Navigate } from "../../navigation";
import { formatPercent } from "../../format";
import { useAudioDurations, useAudioUrls, useCurrentItemAudio } from "./itemAudio";
import PlayerPanel, { type PlayerCommands } from "./PlayerPanel";
import PracticeItemCard from "./PracticeItemCard";
import ShortcutHelp from "./ShortcutHelp";
import { useAudioPlayer, type PlayerPreferences, type PlayerState } from "./useAudioPlayer";
import { usePracticeProgress } from "./usePracticeProgress";
import { usePracticeShortcuts, type PracticeCommands } from "./usePracticeShortcuts";

interface Props {
  lesson: Lesson;
  initialItems: ItemDetail[];
  savedAnswers: SavedAnswer[];
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
  savedAnswers,
  startIndex,
  preferences,
  navigate,
}: Props) {
  const [items, setItems] = useState(initialItems);
  const [index, setIndex] = useState(startIndex);
  const activeItem = items[index];
  const isLast = index === items.length - 1;

  const updateItem = useCallback((updated: ItemDetail) => {
    setItems((list) => list.map((i) => (i.id === updated.id ? updated : i)));
  }, []);
  const recordAttempt = useCallback((itemId: number, accuracy: number) => {
    setItems((list) =>
      list.map((i) =>
        i.id === itemId
          ? {
              ...i,
              attemptCount: i.attemptCount + 1,
              lastAccuracy: accuracy,
              bestAccuracy: Math.max(i.bestAccuracy ?? 0, accuracy),
            }
          : i,
      ),
    );
  }, []);

  const player = useAudioPlayer(preferences);
  const audioUrlFor = useAudioUrls(updateItem);
  const currentAudio = useCurrentItemAudio(activeItem, player, audioUrlFor);
  const durations = useAudioDurations(items, audioUrlFor);
  const progress = usePracticeProgress({ savedAnswers, onChecked: recordAttempt });
  useSavedPlayerPreferences(player.state);

  const answerBoxes = useRef(new Map<number, HTMLTextAreaElement>());
  /**
   * Set when the user drives the player with plain shortcuts outside the
   * answer box; the next item then leaves the focus where it is.
   */
  const keepFocusOutsideAnswer = useRef(false);

  useEffect(() => {
    if (!keepFocusOutsideAnswer.current) answerBoxes.current.get(activeItem.id)?.focus();
    keepFocusOutsideAnswer.current = false;
  }, [activeItem.id]);

  const goTo = (target: number) => {
    if (target >= 0 && target < items.length && target !== index) setIndex(target);
  };

  const hide = (itemId: number) => {
    progress.hide(itemId);
    if (itemId === activeItem.id) answerBoxes.current.get(itemId)?.focus();
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
      if (!progress.progressOf(activeItem.id).isRevealed) progress.reveal(activeItem.id);
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
            Checked {progress.checkedCount} of {items.length}
            {progress.averageAccuracy !== null &&
              ` · average ${formatPercent(progress.averageAccuracy)}`}
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
              isChecking={progress.isChecking(item.id)}
              error={progress.errorOf(item.id)}
              answerRef={registerAnswerBox(item.id)}
              playerPanel={
                <PlayerPanel
                  player={player}
                  isActive={isActive}
                  duration={durations.get(item.id)}
                  currentAudio={currentAudio}
                  commands={playerCommandsFor(rowIndex)}
                  hasPrevious={rowIndex > 0}
                  hasNext={rowIndex < items.length - 1}
                />
              }
              actions={{
                changeAnswer: (answer) => progress.setAnswer(item.id, answer),
                reveal: () => progress.reveal(item.id),
                hide: () => hide(item.id),
                activate: () => goTo(rowIndex),
                dismissError: progress.dismissError,
              }}
            />
          );
        })}
      </ol>

      <ShortcutHelp />
    </main>
  );
}

/** Remembers speed and loop for the next session; the initial values came from there. */
function useSavedPlayerPreferences({ speed, isLooping }: PlayerState) {
  const isInitial = useRef(true);
  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }
    api.savePlayerPreferences(speed, isLooping).catch(() => undefined);
  }, [speed, isLooping]);
}
