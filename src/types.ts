// Mirrors the Rust models serialized by the Tauri commands.

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

export interface ItemView {
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
  items: ItemView[];
}

export interface GenerationSummary {
  generated: number;
  cached: number;
  failed: number;
  errors: string[];
}

export interface AudioProgress {
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

export interface Settings {
  voice: string;
  speakingRate: number;
  pitch: number;
  azureRegion: string;
  azureKey: string;
  playbackSpeed: number;
  loopEnabled: boolean;
}

export interface SettingsView {
  settings: Settings;
  keyFromEnv: boolean;
  regionFromEnv: boolean;
  credentialsConfigured: boolean;
}

export const PLAYBACK_SPEEDS = [0.6, 0.75, 0.9, 1.0, 1.1, 1.25] as const;
export const MAX_RECOMMENDED_WORDS = 30;
