import { useCallback, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { CheckResult } from "../../api/types";

/** What the learner has done with one item during this session. */
export interface ItemProgress {
  answer: string;
  /** The latest check; kept while the original text is hidden again. */
  result: CheckResult | null;
  /** The answer as it was when `result` was produced. */
  checkedAnswer: string | null;
  isRevealed: boolean;
  /** Replays of this item's audio, sent along with each check. */
  replayCount: number;
}

const NOT_STARTED: ItemProgress = {
  answer: "",
  result: null,
  checkedAnswer: null,
  isRevealed: false,
  replayCount: 0,
};

/**
 * Each item's answer through the session: typed, checked when its original
 * text is shown, and editable again once the text is hidden.
 * `onChecked` is told about every recorded attempt.
 */
export function usePracticeProgress(onChecked: (itemId: number, accuracy: number) => void) {
  const [progressById, setProgressById] = useState<ReadonlyMap<number, ItemProgress>>(new Map());
  const [checkingItemId, setCheckingItemId] = useState<number | null>(null);
  const [checkError, setCheckError] = useState<{ itemId: number; message: string } | null>(null);

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

  /** Shows the original text; the answer is checked first unless unchanged since the last check. */
  const reveal = async (itemId: number) => {
    const progress = progressOf(itemId);
    const isAlreadyChecked = progress.result !== null && progress.checkedAnswer === progress.answer;
    if (isAlreadyChecked) {
      update(itemId, () => ({ isRevealed: true }));
      return;
    }
    if (checkingItemId !== null) return;
    setCheckingItemId(itemId);
    setCheckError(null);
    try {
      const result = await api.checkAnswer(itemId, progress.answer, progress.replayCount);
      update(itemId, () => ({ result, checkedAnswer: progress.answer, isRevealed: true }));
      onChecked(itemId, result.accuracy);
    } catch (e) {
      setCheckError({ itemId, message: errorMessage(e) });
    } finally {
      setCheckingItemId(null);
    }
  };

  const accuracies = [...progressById.values()].flatMap((p) => p.result?.accuracy ?? []);

  return {
    progressOf,
    checkedCount: accuracies.length,
    averageAccuracy: accuracies.length
      ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length
      : null,
    isChecking: (itemId: number) => checkingItemId === itemId,
    checkErrorOf: (itemId: number) => (checkError?.itemId === itemId ? checkError.message : null),
    dismissCheckError: () => setCheckError(null),
    setAnswer: (itemId: number, answer: string) => update(itemId, () => ({ answer })),
    countReplay: (itemId: number) =>
      update(itemId, (progress) => ({ replayCount: progress.replayCount + 1 })),
    reveal,
    hide: (itemId: number) => update(itemId, () => ({ isRevealed: false })),
  };
}
