import type { CheckResult, DiffKind } from "../../api/types";
import { formatPercent } from "../../format";
import DiffView from "./DiffView";

/** The score of a checked answer above its word-by-word feedback. */
export default function AnswerResult({
  result,
  replayCount,
}: {
  result: CheckResult;
  replayCount: number;
}) {
  const count = (kind: DiffKind) => result.diff.filter((token) => token.kind === kind).length;
  const details = [
    `${result.correctWords} correct`,
    count("changed") > 0 && `${count("changed")} incorrect`,
    count("missing") > 0 && `${count("missing")} missing`,
    count("extra") > 0 && `${count("extra")} extra`,
    replayCount > 0 && `${replayCount} replays`,
  ].filter(Boolean);

  return (
    <div className="feedback">
      <div className="score">
        {result.isCorrect && (
          <span className="score-icon" aria-hidden="true">
            ✓
          </span>
        )}
        <strong>{formatPercent(result.accuracy)} correct</strong>
        <span className="score-details">{details.join(" · ")}</span>
      </div>
      <DiffView diff={result.diff} />
    </div>
  );
}
