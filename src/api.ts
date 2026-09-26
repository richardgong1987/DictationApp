import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AudioProgress,
  CheckResult,
  GenerationSummary,
  ItemView,
  LessonDetail,
  LessonSummary,
  Settings,
  SettingsView,
} from "./types";

export const api = {
  listLessons: () => invoke<LessonSummary[]>("list_lessons"),
  importLesson: (path: string) => invoke<LessonDetail>("import_lesson", { path }),
  getLesson: (lessonId: string) => invoke<LessonDetail>("get_lesson", { lessonId }),
  deleteLesson: (lessonId: string) => invoke<void>("delete_lesson", { lessonId }),

  generateLessonAudio: (lessonId: string, force = false) =>
    invoke<GenerationSummary>("generate_lesson_audio", { lessonId, force }),
  generateItemAudio: (itemId: number, force = false) =>
    invoke<ItemView>("generate_item_audio", { itemId, force }),
  /** Raw MP3 bytes for one item. */
  getItemAudio: (itemId: number) => invoke<ArrayBuffer>("get_item_audio", { itemId }),

  checkAnswer: (itemId: number, answer: string, replayCount: number) =>
    invoke<CheckResult>("check_answer", { itemId, answer, replayCount }),

  getSettings: () => invoke<SettingsView>("get_settings"),
  saveSettings: (settings: Settings) => invoke<SettingsView>("save_settings", { settings }),
  savePlayerPreferences: (playbackSpeed: number, loopEnabled: boolean) =>
    invoke<void>("save_player_preferences", { playbackSpeed, loopEnabled }),
};

export function onAudioProgress(handler: (p: AudioProgress) => void): Promise<UnlistenFn> {
  return listen<AudioProgress>("audio-progress", (event) => handler(event.payload));
}

/** Tauri command errors arrive as plain strings. */
export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}
