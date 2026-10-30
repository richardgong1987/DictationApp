import { formatTime } from "../../format";
import {
  isRunning,
  isUnderway,
  type RepeatPause,
  type RepeatUnit,
  type ShadowingPlayer,
  type ShadowingState,
} from "./shadowingPlayer";

const REPEAT_UNITS: { value: RepeatUnit; label: string }[] = [
  { value: "passage", label: "Whole passage" },
  { value: "sentence", label: "Sentence" },
  { value: "phrase", label: "Phrase" },
];

const REPEAT_PAUSES: { value: RepeatPause; label: string }[] = [
  { value: 0, label: "No pause" },
  ...[2, 3, 5, 6, 7, 8].map((seconds) => ({ value: seconds, label: `${seconds} seconds` })),
  { value: "clipLength", label: "Match the audio's length" },
];

interface Props {
  state: ShadowingState;
  player: ShadowingPlayer;
  passageCount: number;
  /** How many sentences or phrases the current passage has; 1 when it plays whole. */
  segmentCount: number;
  /** Length of the current passage's audio, once known. */
  knownDuration: number | undefined;
}

/**
 * The one player of the article: it plays straight through for reading along,
 * or a part at a time for repeating after it, and stays on a part while looping.
 */
export default function ArticlePlayer({
  state,
  player,
  passageCount,
  segmentCount,
  knownDuration,
}: Props) {
  const { unit, repeatPause, currentTime } = state;
  const length = state.duration > 0 ? state.duration : (knownDuration ?? 0);
  const canSeek =
    state.phase !== "idle" && state.phase !== "loading" && state.phase !== "failed" && length > 0;

  return (
    <section className="card article-player" aria-label="Player">
      <div className="player-bar">
        <div className="transport">
          <button
            type="button"
            className="primary play"
            onClick={() => player.toggleArticle()}
            title="Play / Pause"
          >
            {playLabel(state)}
          </button>
          <button
            type="button"
            onClick={() => player.restartArticle()}
            title="Play the article from the beginning"
          >
            ⏮ Restart
          </button>
          <button
            type="button"
            onClick={() => player.replaySegment()}
            title={`Replay this ${unit} from its beginning`}
            aria-label={`Replay this ${unit} from its beginning`}
          >
            ↺
          </button>
        </div>

        <SegmentStepper
          state={state}
          player={player}
          passageCount={passageCount}
          segmentCount={segmentCount}
        />

        {state.phase === "yourTurn" ? (
          <YourTurn
            remainingMs={state.turnRemainingMs}
            totalMs={state.turnTotalMs}
            isPaused={state.isPaused}
          />
        ) : (
          <div className="timeline">
            <span className="time">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={length}
              step={0.05}
              value={Math.min(currentTime, length)}
              onChange={(e) => player.seek(Number(e.target.value))}
              disabled={!canSeek}
              aria-label="Position in the current passage"
            />
            <span className="time">{length > 0 ? formatTime(length) : "--:--.-"}</span>
          </div>
        )}

        <button
          type="button"
          className={state.isSegmentLooping ? "toggle on" : "toggle"}
          onClick={() => player.toggleLoop()}
          aria-pressed={state.isSegmentLooping}
          title={`Repeat this ${unit}, with time to repeat it aloud in between`}
        >
          ⟳ Loop {unit}
        </button>
        <button
          type="button"
          className={state.isArticleLooping ? "toggle on" : "toggle"}
          onClick={() => player.setArticleLooping(!state.isArticleLooping)}
          aria-pressed={state.isArticleLooping}
          title="Start the article over after the last passage"
        >
          ⟳ Loop article
        </button>
      </div>

      <div className="player-options">
        <span className="article-status muted small" role="status">
          {articleStatus(state, passageCount)}
        </span>
        <label
          className="inline-field"
          title="Play the article whole, one sentence at a time, or in short phrases split at commas"
        >
          Practice by
          <select value={unit} onChange={(e) => player.setUnit(e.target.value as RepeatUnit)}>
            {REPEAT_UNITS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label
          className="inline-field"
          title="Pause after each part for repeating it aloud, also between repetitions while looping"
        >
          Time to repeat aloud
          <select
            value={repeatPause}
            onChange={({ target: { value } }) =>
              player.setRepeatPause(value === "clipLength" ? value : Number(value))
            }
          >
            {REPEAT_PAUSES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.phase === "failed" && (
        <div className="banner error" role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={() => player.retry()}>
            Retry
          </button>
        </div>
      )}
    </section>
  );
}

/** Moves to the previous or next part of the article; also usable while the text is hidden. */
function SegmentStepper({
  state,
  player,
  passageCount,
  segmentCount,
}: Pick<Props, "state" | "player" | "passageCount" | "segmentCount">) {
  const { unit, index } = state;
  // While the previous passage loads, the player's segment can stand for its last one.
  const segment = Math.min(state.segment, segmentCount - 1);
  const [current, count] = unit === "passage" ? [index, passageCount] : [segment, segmentCount];
  const isStopped = !isUnderway(state);
  const isAtStart = index === 0 && segment === 0;
  const isAtEnd = index + 1 >= passageCount && segment + 1 >= segmentCount;
  return (
    <div className="segment-stepper">
      <button
        type="button"
        onClick={() => player.previousSegment()}
        disabled={isStopped || isAtStart}
        title={`Previous ${unit}`}
        aria-label={`Previous ${unit}`}
      >
        ‹
      </button>
      <span className="segment-count" aria-label={`${unit} ${current + 1} of ${count}`}>
        {current + 1}/{count}
      </span>
      <button
        type="button"
        onClick={() => player.nextSegment()}
        disabled={isStopped || isAtEnd}
        title={`Next ${unit}`}
        aria-label={`Next ${unit}`}
      >
        ›
      </button>
    </div>
  );
}

/** Takes the timeline's place while the learner repeats what they heard aloud. */
function YourTurn({
  remainingMs,
  totalMs,
  isPaused,
}: {
  remainingMs: number;
  totalMs: number;
  isPaused: boolean;
}) {
  const share = totalMs > 0 ? remainingMs / totalMs : 0;
  return (
    <div className="timeline your-turn" role="status">
      <strong>Your turn</strong>
      <span className="turn-bar" aria-hidden="true">
        <span style={{ width: `${share * 100}%` }} />
      </span>
      <span className="countdown">
        {Math.ceil(remainingMs / 1000)}
        {isPaused && " · paused"}
      </span>
    </div>
  );
}

function playLabel(state: ShadowingState): string {
  if (!isUnderway(state) || state.phase === "failed") return "▶ Play article";
  return isRunning(state) ? "❚❚ Pause" : "▶ Resume";
}

function articleStatus(state: ShadowingState, passageCount: number): string {
  const passage = `Passage ${state.index + 1} of ${passageCount}`;
  switch (state.phase) {
    case "idle":
      return state.repeatPause === 0
        ? "Play every passage in order and read along, or click the text to start there."
        : `Play every passage in order, repeating each ${state.unit} aloud after it.`;
    case "ended":
      return "Finished the article.";
    case "failed":
      return `Stopped at passage ${state.index + 1}.`;
    case "loading":
      return `${passage} · loading…`;
    default:
      return `${passage}${state.isPaused ? " · paused" : ""}`;
  }
}
