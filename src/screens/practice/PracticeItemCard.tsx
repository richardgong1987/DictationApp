import { useEffect, useRef, type ReactNode, type Ref } from "react";
import type { ItemDetail } from "../../api/types";
import { formatPercent } from "../../format";
import ErrorBanner from "../../components/ErrorBanner";
import AnswerResult from "./AnswerResult";
import ControlButton from "./ControlButton";
import type { ItemProgress } from "./usePracticeProgress";

export interface CardActions {
  changeAnswer: (answer: string) => void;
  /** Shows the original text, checking the answer first. */
  reveal: () => void;
  /** Hides the original text so the answer can be edited again. */
  hide: () => void;
  /** Makes this the current item, the one the player and shortcuts act on. */
  activate: () => void;
  dismissError: () => void;
}

interface Props {
  item: ItemDetail;
  progress: ItemProgress;
  isActive: boolean;
  isChecking: boolean;
  error: string | null;
  /** This item's audio controls. */
  playerPanel: ReactNode;
  answerRef: Ref<HTMLTextAreaElement>;
  actions: CardActions;
}

/** One dictation item: its audio controls, the hidden original text and the answer. */
export default function PracticeItemCard({
  item,
  progress,
  isActive,
  isChecking,
  error,
  playerPanel,
  answerRef,
  actions,
}: Props) {
  const cardRef = useRef<HTMLLIElement>(null);
  const { result, isRevealed } = progress;
  // Untouched items stay compact until they become the current one.
  const showsAnswer = isActive || isRevealed || progress.answer !== "";

  useEffect(() => {
    if (isActive) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [isActive]);

  return (
    <li ref={cardRef} className={`card practice-card ${isActive ? "active" : ""}`}>
      <span className="item-number">{item.position}</span>
      <div className="practice-card-body">
        {playerPanel}

        <ControlButton
          className="reveal-toggle"
          onClick={isRevealed ? actions.hide : actions.reveal}
          disabled={isChecking}
          aria-expanded={isRevealed}
          title={isRevealed ? "Hide the original text to edit your answer" : "Check your answer (Enter)"}
        >
          {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
          {isChecking ? "Checking…" : isRevealed ? "Hide original text" : "Show original text"}
          {item.attemptCount > 0 && (
            <span className="muted small best">best {formatPercent(item.bestAccuracy)}</span>
          )}
        </ControlButton>

        {isRevealed && result && <p className="original-text">{result.sourceText}</p>}

        {showsAnswer && (
          <textarea
            ref={answerRef}
            className="typing-area"
            rows={2}
            value={progress.answer}
            onChange={(e) => actions.changeAnswer(e.target.value)}
            onFocus={actions.activate}
            readOnly={isRevealed}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            placeholder="Type what you hear…"
            aria-label={`Answer for item ${item.position}`}
          />
        )}

        {isRevealed && result && <AnswerResult result={result} replayCount={progress.replayCount} />}
        <ErrorBanner message={error} onDismiss={actions.dismissError} />
      </div>
    </li>
  );
}

function EyeIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
