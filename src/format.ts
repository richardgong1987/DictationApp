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
