import type { DiffToken } from "../../api/types";

/** Word-by-word feedback: one chip per word of the Rust diff. */
export default function DiffView({ diff }: { diff: DiffToken[] }) {
  if (diff.length === 0) return <p className="muted">Nothing to compare.</p>;
  return (
    <div className="word-chips">
      {diff.map((token, i) => (
        <WordChip key={i} token={token} />
      ))}
    </div>
  );
}

function WordChip({ token }: { token: DiffToken }) {
  switch (token.kind) {
    case "equal":
      return <span className="chip equal">{token.expected}</span>;
    case "missing":
      return (
        <span className="chip missing" title="Missing from your answer">
          {token.expected}
        </span>
      );
    case "extra":
      return (
        <span className="chip extra" title="Not in the original">
          <s>{token.actual}</s>
        </span>
      );
    case "changed":
      return (
        <span className="chip changed" title={`You wrote "${token.actual}"`}>
          {token.actual} → {token.expected}
        </span>
      );
  }
}
