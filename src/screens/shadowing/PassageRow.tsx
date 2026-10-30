import { Fragment, useEffect, useRef, type KeyboardEvent } from "react";
import type { ItemDetail } from "../../api/types";
import { formatTime } from "../../format";
import type { Segment } from "./passageSegments";
import { isRunning, type RepeatUnit, type ShadowingState } from "./shadowingPlayer";

export interface PassageCommands {
  togglePlay: () => void;
  replay: () => void;
  toggleLoop: () => void;
  toggleContinue: () => void;
  playSegment: (segment: number) => void;
  seek: (seconds: number) => void;
  retry: () => void;
}

interface Props {
  item: ItemDetail;
  /** The player's state while this passage is the one in it; null otherwise. */
  playback: ShadowingState | null;
  unit: RepeatUnit;
  /** Its sentences or phrases, once its audio has been measured; null when practised whole. */
  segments: Segment[] | null;
  /** Length of this passage's audio, once known. */
  knownDuration: number | undefined;
  isTextShown: boolean;
  isLastPassage: boolean;
  commands: PassageCommands;
}

/** One passage: its own player for repeated practice, and its original text. */
export default function PassageRow({
  item,
  playback,
  unit,
  segments,
  knownDuration,
  isTextShown,
  isLastPassage,
  commands,
}: Props) {
  const rowRef = useRef<HTMLLIElement>(null);
  const isPractising = playback?.mode === "passage";
  const isInArticle = playback?.mode === "article";
  const isPlaying = playback !== null && isRunning(playback);
  const isLooping = playback?.isPassageLooping ?? false;
  const isContinuing = isInArticle && playback.phase !== "ended";
  const isLoading = playback?.phase === "loading" && !playback.isPaused;
  const length = playback && playback.duration > 0 ? playback.duration : (knownDuration ?? 0);
  const currentTime = playback?.currentTime ?? 0;
  const canSeek =
    playback !== null && length > 0 && playback.phase !== "loading" && playback.phase !== "failed";
  const hasParts = segments !== null && segments.length > 1;
  const currentSegment = playback?.segment ?? null;

  // Follow the article as it moves from passage to passage.
  useEffect(() => {
    if (isInArticle) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [isInArticle]);

  return (
    <li ref={rowRef} className={`card practice-card passage-card ${playback ? "active" : ""}`}>
      <span className="item-number">{item.position}</span>
      <div className="player-bar" role="group" aria-label={`Passage ${item.position}`}>
        <div className="transport">
          <button
            type="button"
            className="primary play"
            onClick={commands.togglePlay}
            title={playback ? "Play / Pause" : "Practice this passage on its own"}
          >
            {isLoading ? "Loading…" : isPlaying ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button
            type="button"
            onClick={commands.replay}
            title={`Replay this ${unit} from its beginning`}
            aria-label={`Replay this ${unit} from its beginning`}
          >
            ↺
          </button>
        </div>

        {hasParts && (
          <SegmentStepper
            unit={unit}
            current={currentSegment ?? 0}
            count={segments.length}
            playSegment={commands.playSegment}
          />
        )}

        {playback?.phase === "yourTurn" ? (
          <YourTurn
            remainingMs={playback.turnRemainingMs}
            totalMs={playback.turnTotalMs}
            isPaused={playback.isPaused}
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
              onChange={(e) => commands.seek(Number(e.target.value))}
              disabled={!canSeek}
              aria-label={`Position in passage ${item.position}`}
            />
            <span className="time">{length > 0 ? formatTime(length) : "--:--.-"}</span>
          </div>
        )}

        <button
          type="button"
          className={isLooping ? "toggle on" : "toggle"}
          onClick={commands.toggleLoop}
          aria-pressed={isLooping}
          title={`Repeat this ${unit}, with time to repeat it aloud in between`}
        >
          ⟳ Loop {unit}
        </button>

        <button
          type="button"
          className={isContinuing ? "toggle on" : "toggle"}
          onClick={commands.toggleContinue}
          aria-pressed={isContinuing}
          disabled={isLastPassage}
          title="Carry on through the next passages instead of stopping after this one"
        >
          ↓ Continue
        </button>
      </div>

      {isTextShown &&
        (hasParts ? (
          <SegmentedText
            text={item.text}
            segments={segments}
            current={currentSegment}
            unit={unit}
            playSegment={commands.playSegment}
          />
        ) : (
          <p className="original-text">{item.text}</p>
        ))}

      {isPractising && playback.phase === "failed" && (
        <div className="banner error" role="alert">
          <span>{playback.error}</span>
          <button type="button" onClick={commands.retry}>
            Retry
          </button>
        </div>
      )}
    </li>
  );
}

/** Moves to the previous or next sentence or phrase; also usable while the text is hidden. */
function SegmentStepper({
  unit,
  current,
  count,
  playSegment,
}: {
  unit: RepeatUnit;
  current: number;
  count: number;
  playSegment: (segment: number) => void;
}) {
  return (
    <div className="segment-stepper">
      <button
        type="button"
        onClick={() => playSegment(current - 1)}
        disabled={current === 0}
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
        onClick={() => playSegment(current + 1)}
        disabled={current + 1 >= count}
        title={`Next ${unit}`}
        aria-label={`Next ${unit}`}
      >
        ›
      </button>
    </div>
  );
}

/** The passage's text, where clicking a sentence or phrase plays it. */
function SegmentedText({
  text,
  segments,
  current,
  unit,
  playSegment,
}: {
  text: string;
  segments: Segment[];
  /** The one in the player, if this passage is. */
  current: number | null;
  unit: RepeatUnit;
  playSegment: (segment: number) => void;
}) {
  const onKeyDown = (event: KeyboardEvent, segment: number) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    playSegment(segment);
  };
  return (
    <p className="original-text">
      {segments.map((segment, index) => (
        <Fragment key={segment.from}>
          {text.slice(index === 0 ? 0 : segments[index - 1].to, segment.from)}
          <span
            role="button"
            tabIndex={0}
            className={index === current ? "segment current" : "segment"}
            onClick={() => playSegment(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            title={`Play this ${unit}`}
          >
            {text.slice(segment.from, segment.to)}
          </span>
        </Fragment>
      ))}
      {text.slice(segments[segments.length - 1].to)}
    </p>
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
