import { useCallback, useEffect, useState } from "react";
import { api, onAudioGenerationProgress } from "../../api/client";
import type { AudioGenerationSummary, AudioStatus } from "../../api/types";

export interface GenerationProgress {
  done: number;
  total: number;
}

/**
 * Runs lesson-wide audio generation and follows its progress events.
 * `onItemStatus` receives each item's new audio status as soon as it is known.
 */
export function useAudioGeneration(
  lessonId: string,
  onItemStatus: (itemId: number, status: AudioStatus) => void,
) {
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [summary, setSummary] = useState<AudioGenerationSummary | null>(null);

  useEffect(() => {
    const unlisten = onAudioGenerationProgress((event) => {
      if (event.lessonId !== lessonId) return;
      setProgress({ done: event.done, total: event.total });
      onItemStatus(event.itemId, event.audioStatus);
    });
    return () => {
      unlisten.then((stopListening) => stopListening());
    };
  }, [lessonId, onItemStatus]);

  /** Rejects with the backend's error message; progress is cleared either way. */
  const generate = useCallback(
    async (force: boolean) => {
      setSummary(null);
      setProgress({ done: 0, total: 0 });
      try {
        setSummary(await api.generateLessonAudio(lessonId, force));
      } finally {
        setProgress(null);
      }
    },
    [lessonId],
  );

  return { progress, summary, isGenerating: progress !== null, generate };
}
