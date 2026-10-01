/** Every screen the app can show, with the parameters it needs. */
export type Route =
  | { name: "library" }
  | { name: "lesson"; lessonId: string; autoGenerate?: boolean }
  /** Dictation. Without `startIndex`, it continues where it stopped last time. */
  | { name: "practice"; lessonId: string; startIndex?: number }
  | { name: "shadowing"; lessonId: string }
  | { name: "settings"; back: Route };

export type Navigate = (route: Route) => void;
