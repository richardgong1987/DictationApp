// Mirrors the response types the Rust commands serialize (src-tauri/src).

export type AudioStatus = "ready" | "stale" | "missing";

export interface Lesson {
  id: string;
  title: string;
  /** The imported file; null when the text was pasted. */
  sourcePath: string | null;
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

/** `tts::TtsProviderKind` */
export type TtsProvider = "azure" | "elevenlabs";

export interface Settings {
  ttsProvider: TtsProvider;
  azureVoice: string;
  speakingRate: number;
  /** Azure only. */
  pitch: number;
  azureRegion: string;
  azureKey: string;
  elevenlabsVoiceId: string;
  elevenlabsModel: string;
  elevenlabsKey: string;
  playbackSpeed: number;
  loopEnabled: boolean;
}

/** `settings::VoiceSettings`: the settings that decide how generated audio sounds. */
export type VoiceSettings = Pick<
  Settings,
  "ttsProvider" | "azureVoice" | "elevenlabsVoiceId" | "elevenlabsModel" | "speakingRate" | "pitch"
>;

export interface ExportSummary {
  lessonCount: number;
  audioCount: number;
}

export interface ImportSummary {
  /** Lessons this device did not have. */
  addedLessons: number;
  /** Lessons already here; nothing of theirs was replaced. */
  existingLessons: number;
  addedAudio: number;
  /** Of `addedAudio`, files made with other voice settings than this device's. */
  audioWithOtherVoice: number;
  exportedVoice: VoiceSettings;
}

export interface SettingsDetail {
  settings: Settings;
  azureKeyFromEnv: boolean;
  azureRegionFromEnv: boolean;
  elevenlabsKeyFromEnv: boolean;
  azureConfigured: boolean;
  elevenlabsConfigured: boolean;
  /** Whether the selected provider can generate audio. */
  credentialsConfigured: boolean;
}
