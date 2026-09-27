import type { CheckResult } from "../../api/types";
import { formatPercent } from "../../format";
import DiffView from "./DiffView";

export default function AnswerResult({
  result,
  replayCount,
}: {
  result: CheckResult;
  replayCount: number;
}) {
  return (
    <section className={`card result ${result.isCorrect ? "correct" : ""}`}>
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
      <dl>
        <dt>Original</dt>
        <dd className="source">{result.sourceText}</dd>
        <dt>Your answer</dt>
        <dd>{result.answer || <span className="muted">(empty)</span>}</dd>
        {!result.isCorrect && (
          <>
            <dt>Differences</dt>
            <dd>
              <DiffView diff={result.diff} />
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
