import type { DiffToken } from "../types";

/** Word-level diff between the source passage and the typed answer. */
export default function DiffView({ diff }: { diff: DiffToken[] }) {
  if (diff.length === 0) return <p className="muted">Nothing to compare.</p>;
  return (
    <div>
      <p className="diff">
        {diff.map((t, i) => {
          switch (t.kind) {
            case "equal":
              return (
                <span key={i} className="tok equal">
                  {t.expected}
                </span>
              );
            case "missing":
              return (
                <span key={i} className="tok missing" title="Missing from your answer">
                  {t.expected}
                </span>
              );
            case "extra":
              return (
                <span key={i} className="tok extra" title="Not in the original">
                  <s>{t.actual}</s>
                </span>
              );
            case "changed":
              return (
                <span key={i} className="tok changed" title={`You wrote "${t.actual}"`}>
                  <s>{t.actual}</s>
                  <span className="arrow">→</span>
                  <b>{t.expected}</b>
                </span>
              );
          }
        })}
      </p>
      <p className="legend muted">
        <span className="tok missing">missing</span>
        <span className="tok changed">
          <s>typed</s>
          <span className="arrow">→</span>
          <b>correct</b>
        </span>
        <span className="tok extra">
          <s>extra</s>
        </span>
      </p>
    </div>
  );
}
