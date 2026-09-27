import { useCallback, useState } from "react";
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

/** Per-item answers, results and reveal state for the practice session. */
export function usePracticeProgress() {
  const [progressById, setProgressById] = useState<ReadonlyMap<number, ItemProgress>>(new Map());

  const update = useCallback(
    (itemId: number, change: (progress: ItemProgress) => Partial<ItemProgress>) => {
      setProgressById((all) => {
        const current = all.get(itemId) ?? NOT_STARTED;
        return new Map(all).set(itemId, { ...current, ...change(current) });
      });
    },
    [],
  );

  return {
    progressOf: (itemId: number) => progressById.get(itemId) ?? NOT_STARTED,
    results: [...progressById.values()].flatMap((progress) => progress.result ?? []),
    setAnswer: (itemId: number, answer: string) => update(itemId, () => ({ answer })),
    countReplay: (itemId: number) =>
      update(itemId, (progress) => ({ replayCount: progress.replayCount + 1 })),
    recordCheck: (itemId: number, answer: string, result: CheckResult) =>
      update(itemId, () => ({ result, checkedAnswer: answer, isRevealed: true })),
    setRevealed: (itemId: number, isRevealed: boolean) => update(itemId, () => ({ isRevealed })),
  };
}

/** Revealing needs a new check unless the answer is unchanged since the last one. */
export function needsCheck(progress: ItemProgress): boolean {
  return progress.result === null || progress.checkedAnswer !== progress.answer;
}
