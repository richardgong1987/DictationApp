import type { CheckResult } from "../../api/types";
import { formatPercent } from "../../format";
import DiffView, { MarkedText } from "./DiffView";

/**
 * The checked answer, as rows of the exercise block: the revealed script
 * directly above what was typed, wrong words marked in both, then the score
 * and the word-by-word differences.
 */
export default function AnswerResult({
  result,
  replayCount,
}: {
  result: CheckResult;
  replayCount: number;
}) {
  return (
    <>
      <div className="exercise-row">
        <span className="row-label">Script</span>
        <p className="practice-text">
          <MarkedText text={result.sourceText} diff={result.diff} side="expected" />
        </p>
      </div>
      <div className="exercise-row">
        <span className="row-label">Answer</span>
        <p className="practice-text">
          {result.answer ? (
            <MarkedText text={result.answer} diff={result.diff} side="actual" />
          ) : (
            <span className="muted">(empty)</span>
          )}
        </p>
      </div>
      <div className={`exercise-row feedback ${result.isCorrect ? "correct" : ""}`}>
        <span className="row-label">Result</span>
        <div className="score">
          {result.isCorrect ? (
            <strong>✓ Correct</strong>
          ) : (
            <strong>
              {result.correctWords} / {result.sourceWords} words · {formatPercent(result.accuracy)}
            </strong>
          )}
          {replayCount > 0 && <span className="muted small"> · {replayCount} replays</span>}
        </div>
        {!result.isCorrect && <DiffView diff={result.diff} />}
      </div>
    </>
  );
}
