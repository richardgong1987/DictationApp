import type { AudioStatus } from "../../api/types";

const LABELS: Record<AudioStatus, string> = {
  ready: "Audio ready",
  stale: "Voice changed",
  missing: "No audio",
};

export default function AudioBadge({ status, isBusy }: { status: AudioStatus; isBusy: boolean }) {
  if (isBusy) return <span className="badge busy">Generating…</span>;
  return <span className={`badge ${status}`}>{LABELS[status]}</span>;
}
