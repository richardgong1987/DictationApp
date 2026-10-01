import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { LessonDetail } from "../../api/types";
import LoadingPage from "../../components/LoadingPage";
import type { Navigate } from "../../navigation";
import ShadowingSession from "./ShadowingSession";

interface Props {
  lessonId: string;
  navigate: Navigate;
}

/** Loads the lesson, then starts a session. */
export default function ShadowingScreen({ lessonId, navigate }: Props) {
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backToLesson = () => navigate({ name: "lesson", lessonId });

  useEffect(() => {
    api
      .getLesson(lessonId)
      .then(setDetail)
      .catch((e) => setError(errorMessage(e)));
  }, [lessonId]);

  if (!detail) return <LoadingPage backLabel="Lesson" onBack={backToLesson} error={error} />;

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
  return <ShadowingSession lesson={detail.lesson} initialItems={detail.items} navigate={navigate} />;
}
