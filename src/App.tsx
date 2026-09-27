import { useState } from "react";
import type { Route } from "./navigation";
import LibraryScreen from "./screens/LibraryScreen";
import LessonScreen from "./screens/lesson/LessonScreen";
import PracticeScreen from "./screens/practice/PracticeScreen";
import SettingsScreen from "./screens/SettingsScreen";

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "library" });

  switch (route.name) {
    case "library":
      return <LibraryScreen navigate={setRoute} />;
    case "lesson":
      return (
        <LessonScreen
          key={route.lessonId}
          lessonId={route.lessonId}
          autoGenerate={route.autoGenerate ?? false}
          navigate={setRoute}
        />
      );
    case "practice":
      return (
        <PracticeScreen
          key={`${route.lessonId}:${route.startIndex}`}
          lessonId={route.lessonId}
          startIndex={route.startIndex}
          navigate={setRoute}
        />
      );
    case "settings":
      return <SettingsScreen onClose={() => setRoute(route.back)} />;
  }
}
