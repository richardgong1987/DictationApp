import type { TtsProvider, VoiceSettings } from "./api/types";

const TTS_PROVIDER_NAMES: Record<TtsProvider, string> = {
  azure: "Microsoft Azure Speech",
  elevenlabs: "ElevenLabs",
};

/** "elevenlabs" -> "ElevenLabs" */
export function formatTtsProvider(provider: TtsProvider): string {
  return TTS_PROVIDER_NAMES[provider];
}

/** Every setting that changes the audio, e.g. "Microsoft Azure Speech, en-US-JennyNeural, rate +10%". */
export function formatVoice(voice: VoiceSettings): string {
  const parts = [formatTtsProvider(voice.ttsProvider)];
  if (voice.ttsProvider === "azure") {
    parts.push(voice.azureVoice);
    if (voice.pitch !== 0) parts.push(`pitch ${formatSignedPercent(voice.pitch)}`);
  } else {
    parts.push(`voice ${voice.elevenlabsVoiceId}`, voice.elevenlabsModel);
  }
  if (voice.speakingRate !== 0) parts.push(`rate ${formatSignedPercent(voice.speakingRate)}`);
  return parts.join(", ");
}

/** (1, "lesson") -> "1 lesson"; (3, "lesson") -> "3 lessons" */
export function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** 2.44 -> "00:02.4" */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

export function formatSpeed(speed: number): string {
  return `${speed.toFixed(2)}x`;
}

/** 0.75 -> "75%"; no value -> "–" */
export function formatPercent(value: number | null | undefined): string {
  return value == null ? "–" : `${Math.round(value * 100)}%`;
}

/** 10 -> "+10%", 0 -> "0%", -5 -> "-5%" */
export function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value}%`;
}
