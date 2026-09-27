import { Fragment } from "react";
import type { DiffKind, DiffToken } from "../../api/types";

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

/** The script is the diff's `expected` side, the typed answer its `actual` side. */
type DiffSide = "expected" | "actual";

/** Missed or misheard words in the script; wrong or extra words in the answer. */
const ERROR_KINDS: Record<DiffSide, ReadonlySet<DiffKind>> = {
  expected: new Set<DiffKind>(["missing", "changed"]),
  actual: new Set<DiffKind>(["changed", "extra"]),
};

/** Shows `text` as it was written, marking the words the diff reports as wrong. */
export function MarkedText({ text, diff, side }: { text: string; diff: DiffToken[]; side: DiffSide }) {
  return (
    <>
      {markWords(text, diff, side).map(({ word, isError }, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className={isError ? "word error" : "word"}>{word}</span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Pairs each word of `text` with its diff token. The diff lists this side's
 * words in the same order, minus punctuation-only ones such as "—", which the
 * comparison ignores; those stay unmarked.
 */
function markWords(text: string, diff: DiffToken[], side: DiffSide) {
  const sideTokens = diff.filter((token) => token[side] !== null);
  let next = 0;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const token = sideTokens[next];
      if (!token || token[side] !== word) return { word, isError: false };
      next += 1;
      return { word, isError: ERROR_KINDS[side].has(token.kind) };
    });
}
