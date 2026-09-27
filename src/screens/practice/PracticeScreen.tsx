import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { LessonDetail, PracticeProgress } from "../../api/types";
import type { Navigate } from "../../navigation";
import LoadingPage from "../../components/LoadingPage";
import PracticeSession from "./PracticeSession";
import type { PlayerPreferences } from "./useAudioPlayer";

interface Props {
  lessonId: string;
  /** Omitted: continue where practice stopped last time. */
  startIndex: number | undefined;
  navigate: Navigate;
}

interface LoadedPractice {
  detail: LessonDetail;
  preferences: PlayerPreferences;
  progress: PracticeProgress;
}

/** Loads the lesson, the saved answers and the player preferences, then starts a session. */
export default function PracticeScreen({ lessonId, startIndex, navigate }: Props) {
  const [loaded, setLoaded] = useState<LoadedPractice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getLesson(lessonId), api.getSettings(), api.getPracticeProgress(lessonId)])
      .then(([detail, settingsDetail, progress]) => {
        const { playbackSpeed, loopEnabled } = settingsDetail.settings;
        setLoaded({ detail, progress, preferences: { speed: playbackSpeed, isLooping: loopEnabled } });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [lessonId]);

  if (!loaded) {
    return (
      <LoadingPage
        backLabel="Lesson"
        onBack={() => navigate({ name: "lesson", lessonId })}
        error={error}
      />
    );
  }
  const { detail, progress, preferences } = loaded;
  if (detail.items.length === 0) {
    return (
      <main className="page">
        <p>This lesson has no items.</p>
      </main>
    );
  }
  const resumeIndex = detail.items.findIndex((item) => item.id === progress.resumeItemId);
  const firstIndex = startIndex ?? Math.max(resumeIndex, 0);
  const lastIndex = detail.items.length - 1;
  return (
    <PracticeSession
      lesson={detail.lesson}
      initialItems={detail.items}
      savedAnswers={progress.answers}
      startIndex={Math.min(Math.max(firstIndex, 0), lastIndex)}
      preferences={preferences}
      navigate={navigate}
    />
  );
}
