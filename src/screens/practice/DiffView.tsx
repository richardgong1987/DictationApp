import type { DiffToken } from "../../api/types";

/** Word-level diff between the source passage and the typed answer. */
export default function DiffView({ diff }: { diff: DiffToken[] }) {
  if (diff.length === 0) return <p className="muted">Nothing to compare.</p>;
  return (
    <div>
      <p className="diff">
        {diff.map((token, i) => (
          <DiffTokenView key={i} token={token} />
        ))}
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

function DiffTokenView({ token }: { token: DiffToken }) {
  switch (token.kind) {
    case "equal":
      return <span className="tok equal">{token.expected}</span>;
    case "missing":
      return (
        <span className="tok missing" title="Missing from your answer">
          {token.expected}
        </span>
      );
    case "extra":
      return (
        <span className="tok extra" title="Not in the original">
          <s>{token.actual}</s>
        </span>
      );
    case "changed":
      return (
        <span className="tok changed" title={`You wrote "${token.actual}"`}>
          <s>{token.actual}</s>
          <span className="arrow">→</span>
          <b>{token.expected}</b>
        </span>
      );
  }
}
