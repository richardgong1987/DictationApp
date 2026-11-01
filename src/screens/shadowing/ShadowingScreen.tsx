import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { LessonDetail, ShadowingPosition } from "../../api/types";
import LoadingPage from "../../components/LoadingPage";
import type { Navigate } from "../../navigation";
import ShadowingSession from "./ShadowingSession";

interface Props {
  lessonId: string;
  navigate: Navigate;
}

/** Loads the lesson and where the learner stopped, then starts a session. */
export default function ShadowingScreen({ lessonId, navigate }: Props) {
  const [loaded, setLoaded] = useState<{
    detail: LessonDetail;
    savedPosition: ShadowingPosition | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backToLesson = () => navigate({ name: "lesson", lessonId });

  useEffect(() => {
    Promise.all([api.getLesson(lessonId), api.getShadowingPosition(lessonId)])
      .then(([detail, savedPosition]) => setLoaded({ detail, savedPosition }))
      .catch((e) => setError(errorMessage(e)));
  }, [lessonId]);

  if (!loaded) return <LoadingPage backLabel="Lesson" onBack={backToLesson} error={error} />;

  const { detail, savedPosition } = loaded;
  if (detail.items.length === 0) {
    return (
      <main className="page">
        <button className="link" onClick={backToLesson}>
          ← Lesson
        </button>
        <p>This lesson has no items.</p>
      </main>
    );
  }
  return (
    <ShadowingSession
      lesson={detail.lesson}
      initialItems={detail.items}
      savedPosition={savedPosition}
      navigate={navigate}
    />
  );
}
