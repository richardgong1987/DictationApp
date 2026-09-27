import type { AudioGenerationSummary } from "../../api/types";
import type { GenerationProgress } from "./useAudioGeneration";

/** How many per-item errors to list; the rest are summarized in the count. */
const MAX_ERRORS_SHOWN = 3;

interface Props {
  progress: GenerationProgress | null;
  summary: AudioGenerationSummary | null;
}

/** A progress bar while audio is generated, then the outcome of the run. */
export default function AudioGenerationStatus({ progress, summary }: Props) {
  if (progress) {
    return (
      <div className="banner info">
        Generating audio… {progress.total > 0 ? `${progress.done} / ${progress.total}` : ""}
        <progress value={progress.done} max={Math.max(progress.total, 1)} />
      </div>
    );
  }
  if (!summary) return null;
  return (
    <div className={`banner ${summary.failed > 0 ? "error" : "success"}`}>
      <div>
        Audio: {summary.generated} generated, {summary.cached} already cached
        {summary.failed > 0 && `, ${summary.failed} failed`}.
      </div>
      {summary.errors.slice(0, MAX_ERRORS_SHOWN).map((error) => (
        <div key={error} className="small">
          {error}
        </div>
      ))}
    </div>
  );
}
