import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { CheckResult, SavedAnswer } from "../../api/types";

/** Typed answers are saved once typing pauses for this long. */
const SAVE_DELAY_MS = 500;

/** Where the learner is with one item. */
export interface ItemProgress {
  answer: string;
  /** The latest check; kept while the original text is hidden again. */
  result: CheckResult | null;
  /** The answer as it was when `result` was produced. */
  checkedAnswer: string | null;
  isRevealed: boolean;
  /** Replays of this item's audio in this session, sent along with each check. */
  replayCount: number;
}

const NOT_STARTED: ItemProgress = {
  answer: "",
  result: null,
  checkedAnswer: null,
  isRevealed: false,
  replayCount: 0,
};

interface Options {
  /** Answers kept from earlier sessions. */
  savedAnswers: SavedAnswer[];
  /** Told about every recorded attempt. */
  onChecked: (itemId: number, accuracy: number) => void;
}

/**
 * Each item's answer: typed (and saved as it is typed), checked when its
 * original text is shown, and editable again once the text is hidden.
 * Answers are kept between sessions until the learner clears them.
 */
export function usePracticeProgress({ savedAnswers, onChecked }: Options) {
  const [progressById, setProgressById] = useState<ReadonlyMap<number, ItemProgress>>(() =>
    restore(savedAnswers),
  );
  const [checkingItemId, setCheckingItemId] = useState<number | null>(null);
  const [error, setError] = useState<{ itemId: number; message: string } | null>(null);

  const reportSaveError = useCallback((itemId: number, e: unknown) => {
    setError({ itemId, message: `Your answer could not be saved: ${errorMessage(e)}` });
  }, []);
  const saving = useAnswerSaving(reportSaveError);

  const update = useCallback(
    (itemId: number, change: (progress: ItemProgress) => Partial<ItemProgress>) => {
      setProgressById((all) => {
        const current = all.get(itemId) ?? NOT_STARTED;
        return new Map(all).set(itemId, { ...current, ...change(current) });
      });
    },
    [],
  );

  const progressOf = (itemId: number) => progressById.get(itemId) ?? NOT_STARTED;

  const setAnswer = (itemId: number, answer: string) => {
    update(itemId, () => ({ answer }));
    saving.saveLater(itemId, answer);
  };

  /** Shows the original text; the answer is checked first unless unchanged since the last check. */
  const reveal = async (itemId: number) => {
    const progress = progressOf(itemId);
    const isAlreadyChecked = progress.result !== null && progress.checkedAnswer === progress.answer;
    if (isAlreadyChecked) {
      update(itemId, () => ({ isRevealed: true }));
      return;
    }
    if (checkingItemId !== null) return;
    // Keeps the answer even if the check fails; the check then marks it checked.
    saving.saveNow(itemId);
    setCheckingItemId(itemId);
    setError(null);
    try {
      const result = await api.checkAnswer(itemId, progress.answer, progress.replayCount);
      update(itemId, () => ({ result, checkedAnswer: progress.answer, isRevealed: true }));
      onChecked(itemId, result.accuracy);
    } catch (e) {
      setError({ itemId, message: errorMessage(e) });
    } finally {
      setCheckingItemId(null);
    }
  };

  /** Deletes every answer in the lesson, here and saved. Rejects if deleting fails. */
  const clearAll = async (lessonId: string) => {
    saving.discardAll();
    await api.clearAnswers(lessonId);
    setProgressById(new Map());
    setError(null);
  };

  const all = [...progressById.values()];
  const accuracies = all.flatMap((p) => p.result?.accuracy ?? []);

  return {
    progressOf,
    hasAnswers: all.some((p) => p.answer !== "" || p.result !== null),
    checkedCount: accuracies.length,
    averageAccuracy: accuracies.length
      ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length
      : null,
    isChecking: (itemId: number) => checkingItemId === itemId,
    errorOf: (itemId: number) => (error?.itemId === itemId ? error.message : null),
    dismissError: () => setError(null),
    setAnswer,
    countReplay: (itemId: number) =>
      update(itemId, (progress) => ({ replayCount: progress.replayCount + 1 })),
    reveal,
    hide: (itemId: number) => update(itemId, () => ({ isRevealed: false })),
    clearAll,
  };
}

function restore(savedAnswers: SavedAnswer[]): ReadonlyMap<number, ItemProgress> {
  return new Map(
    savedAnswers.map((saved) => [
      saved.itemId,
      {
        answer: saved.text,
        result: saved.result,
        checkedAnswer: saved.result ? saved.text : null,
        isRevealed: saved.result !== null,
        replayCount: 0,
      },
    ]),
  );
}

/**
 * Saves each item's answer once typing pauses, and whatever is still
 * pending when the practice screen closes.
 */
function useAnswerSaving(onError: (itemId: number, error: unknown) => void) {
  const pending = useRef(new Map<number, { answer: string; timer: number }>());

  const saveNow = useCallback(
    (itemId: number) => {
      const draft = pending.current.get(itemId);
      if (!draft) return;
      window.clearTimeout(draft.timer);
      pending.current.delete(itemId);
      api.saveAnswer(itemId, draft.answer).catch((e) => onError(itemId, e));
    },
    [onError],
  );

  const saveLater = useCallback(
    (itemId: number, answer: string) => {
      window.clearTimeout(pending.current.get(itemId)?.timer);
      const timer = window.setTimeout(() => saveNow(itemId), SAVE_DELAY_MS);
      pending.current.set(itemId, { answer, timer });
    },
    [saveNow],
  );

  /** Drops pending saves, so none of them brings back a cleared answer. */
  const discardAll = useCallback(() => {
    for (const draft of pending.current.values()) window.clearTimeout(draft.timer);
    pending.current.clear();
  }, []);

  useEffect(() => {
    const drafts = pending.current;
    return () => {
      for (const itemId of [...drafts.keys()]) saveNow(itemId);
    };
  }, [saveNow]);

  return { saveLater, saveNow, discardAll };
}
