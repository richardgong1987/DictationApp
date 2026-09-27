/** Every screen the app can show, with the parameters it needs. */
export type Route =
  | { name: "library" }
  | { name: "lesson"; lessonId: string; autoGenerate?: boolean }
  | { name: "practice"; lessonId: string; startIndex: number }
  | { name: "settings"; back: Route };

export type Navigate = (route: Route) => void;
