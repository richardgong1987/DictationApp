// Mirrors the response types the Rust commands serialize (src-tauri/src).

export type AudioStatus = "ready" | "stale" | "missing";

export interface Lesson {
  id: string;
  title: string;
  sourcePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface LessonSummary extends Lesson {
  itemCount: number;
  audioReadyCount: number;
  longItemCount: number;
}

export interface ItemDetail {
  id: number;
  position: number;
  text: string;
  wordCount: number;
  tooLong: boolean;
  audioStatus: AudioStatus;
  attemptCount: number;
  bestAccuracy: number | null;
  lastAccuracy: number | null;
}

export interface LessonDetail {
  lesson: Lesson;
  items: ItemDetail[];
}

export interface AudioGenerationSummary {
  generated: number;
  cached: number;
  failed: number;
  errors: string[];
}

export interface AudioGenerationProgress {
  lessonId: string;
  itemId: number;
  done: number;
  total: number;
  audioStatus: AudioStatus;
  error: string | null;
}

export type DiffKind = "equal" | "missing" | "extra" | "changed";

export interface DiffToken {
  kind: DiffKind;
  expected: string | null;
  actual: string | null;
}

export interface CheckResult {
  sourceText: string;
  answer: string;
  isCorrect: boolean;
  accuracy: number;
  correctWords: number;
  sourceWords: number;
  answerWords: number;
  diff: DiffToken[];
}

export interface SavedAnswer {
  itemId: number;
  /** Exactly as typed. */
  text: string;
  /** Present when the answer has been checked. */
  result: CheckResult | null;
}

export interface PracticeProgress {
  answers: SavedAnswer[];
  /** The item to continue with; null until the lesson has been practised. */
  resumeItemId: number | null;
}

export interface Settings {
  voice: string;
  speakingRate: number;
  pitch: number;
  azureRegion: string;
  azureKey: string;
  playbackSpeed: number;
  loopEnabled: boolean;
}

export interface SettingsDetail {
  settings: Settings;
  keyFromEnv: boolean;
  regionFromEnv: boolean;
  credentialsConfigured: boolean;
}
