import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AudioGenerationProgress,
  AudioGenerationSummary,
  CheckResult,
  ItemDetail,
  LessonDetail,
  LessonSummary,
  PracticeProgress,
  Settings,
  SettingsDetail,
} from "./types";

/** Typed wrappers for the Tauri commands in src-tauri/src/commands.rs. */
export const api = {
  listLessons: () => invoke<LessonSummary[]>("list_lessons"),
  importLesson: (path: string) => invoke<LessonDetail>("import_lesson", { path }),
  getLesson: (lessonId: string) => invoke<LessonDetail>("get_lesson", { lessonId }),
  deleteLesson: (lessonId: string) => invoke<void>("delete_lesson", { lessonId }),

  generateLessonAudio: (lessonId: string, force = false) =>
    invoke<AudioGenerationSummary>("generate_lesson_audio", { lessonId, force }),
  generateItemAudio: (itemId: number, force = false) =>
    invoke<ItemDetail>("generate_item_audio", { itemId, force }),
  /** Raw MP3 bytes for one item. */
  getItemAudio: (itemId: number) => invoke<ArrayBuffer>("get_item_audio", { itemId }),

  checkAnswer: (itemId: number, answer: string, replayCount: number) =>
    invoke<CheckResult>("check_answer", { itemId, answer, replayCount }),
  /** Keeps an answer being typed; a blank answer deletes the saved one. */
  saveAnswer: (itemId: number, answer: string) => invoke<void>("save_answer", { itemId, answer }),
  getPracticeProgress: (lessonId: string) =>
    invoke<PracticeProgress>("get_practice_progress", { lessonId }),
  /** Deletes every saved answer in the lesson; statistics are kept. */
  clearAnswers: (lessonId: string) => invoke<void>("clear_answers", { lessonId }),

  getSettings: () => invoke<SettingsDetail>("get_settings"),
  saveSettings: (settings: Settings) => invoke<SettingsDetail>("save_settings", { settings }),
  savePlayerPreferences: (playbackSpeed: number, loopEnabled: boolean) =>
    invoke<void>("save_player_preferences", { playbackSpeed, loopEnabled }),
};

/** `audio::GENERATION_PROGRESS_EVENT` on the Rust side. */
const GENERATION_PROGRESS_EVENT = "audio-generation-progress";

export function onAudioGenerationProgress(
  handler: (progress: AudioGenerationProgress) => void,
): Promise<UnlistenFn> {
  return listen<AudioGenerationProgress>(GENERATION_PROGRESS_EVENT, (event) =>
    handler(event.payload),
  );
}

/** Tauri command errors arrive as plain strings. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
