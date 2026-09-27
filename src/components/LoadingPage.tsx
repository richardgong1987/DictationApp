import ErrorBanner from "./ErrorBanner";

interface Props {
  backLabel: string;
  onBack: () => void;
  /** Shown instead of "Loading…" once loading has failed. */
  error: string | null;
}

/** Stands in for a screen until its data has loaded. */
export default function LoadingPage({ backLabel, onBack, error }: Props) {
  return (
    <main className="page">
      <button className="link" onClick={onBack}>
        ← {backLabel}
      </button>
      <ErrorBanner message={error} />
      {!error && <p className="muted">Loading…</p>}
    </main>
  );
}
