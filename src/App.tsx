import { useState } from "react";
import Library from "./screens/Library";
import LessonDetailScreen from "./screens/LessonDetail";
import Practice from "./screens/Practice";
import SettingsScreen from "./screens/Settings";

export type View =
  | { name: "library" }
  | { name: "lesson"; lessonId: string; autoGenerate?: boolean }
  | { name: "practice"; lessonId: string; startIndex: number }
  | { name: "settings"; back: View };

export default function App() {
  const [view, setView] = useState<View>({ name: "library" });

  switch (view.name) {
    case "library":
      return <Library navigate={setView} />;
    case "lesson":
      return (
        <LessonDetailScreen
          key={view.lessonId}
          lessonId={view.lessonId}
          autoGenerate={view.autoGenerate ?? false}
          navigate={setView}
        />
      );
    case "practice":
      return (
        <Practice
          key={`${view.lessonId}:${view.startIndex}`}
          lessonId={view.lessonId}
          startIndex={view.startIndex}
          navigate={setView}
        />
      );
    case "settings":
      return <SettingsScreen onClose={() => setView(view.back)} />;
  }
}
