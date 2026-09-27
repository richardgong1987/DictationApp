import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { LessonDetail } from "../../api/types";
import type { Navigate } from "../../navigation";
import LoadingPage from "../../components/LoadingPage";
import PracticeSession from "./PracticeSession";
import type { PlayerPreferences } from "./useAudioPlayer";

interface Props {
  lessonId: string;
  startIndex: number;
  navigate: Navigate;
}

/** Loads the lesson and the saved player preferences, then starts a session. */
export default function PracticeScreen({ lessonId, startIndex, navigate }: Props) {
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [preferences, setPreferences] = useState<PlayerPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getLesson(lessonId), api.getSettings()])
      .then(([lessonDetail, settingsDetail]) => {
        const { playbackSpeed, loopEnabled } = settingsDetail.settings;
        setDetail(lessonDetail);
        setPreferences({ speed: playbackSpeed, isLooping: loopEnabled });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [lessonId]);

  if (!detail || !preferences) {
    return (
      <LoadingPage
        backLabel="Lesson"
        onBack={() => navigate({ name: "lesson", lessonId })}
        error={error}
      />
    );
  }
  if (detail.items.length === 0) {
    return (
      <main className="page">
        <p>This lesson has no items.</p>
      </main>
    );
  }
  const lastIndex = detail.items.length - 1;
  return (
    <PracticeSession
      lesson={detail.lesson}
      initialItems={detail.items}
      startIndex={Math.min(Math.max(startIndex, 0), lastIndex)}
      preferences={preferences}
      navigate={navigate}
    />
  );
}
