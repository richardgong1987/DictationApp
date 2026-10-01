// Values the Rust side enforces too; keep them in sync with src-tauri/src.

import type { TtsProvider } from "./types";

/** `lesson::MAX_RECOMMENDED_WORDS` */
export const MAX_RECOMMENDED_WORDS = 30;

/** `settings::PLAYBACK_SPEEDS` */
export const PLAYBACK_SPEEDS = [0.6, 0.75, 0.9, 1.0, 1.1, 1.25] as const;

/** `TtsProviderKind::speaking_rate_range`, in percent. */
export const SPEAKING_RATE_RANGE: Record<TtsProvider, { min: number; max: number }> = {
  azure: { min: -50, max: 100 },
  elevenlabs: { min: -30, max: 20 },
};
