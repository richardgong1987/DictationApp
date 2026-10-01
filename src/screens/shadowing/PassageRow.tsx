import { useEffect, useRef } from "react";
import type { ItemDetail } from "../../api/types";
import { formatTime } from "../../format";
import { isRunning, type ShadowingState } from "./shadowingPlayer";

export interface PassageCommands {
  togglePlay: () => void;
  replay: () => void;
  toggleLoop: () => void;
  seek: (seconds: number) => void;
  retry: () => void;
}

interface Props {
  item: ItemDetail;
  /** The player's state while this passage is the one in it; null otherwise. */
  playback: ShadowingState | null;
  /** Length of this passage's audio, once known. */
  knownDuration: number | undefined;
  isTextShown: boolean;
  commands: PassageCommands;
}

/** One passage: its own player for repeated practice, and its original text. */
export default function PassageRow({ item, playback, knownDuration, isTextShown, commands }: Props) {
  const rowRef = useRef<HTMLLIElement>(null);
  const isPractising = playback?.mode === "passage";
  const isInArticle = playback?.mode === "article";
  const isPlaying = isPractising && isRunning(playback);
  const isLooping = isPractising && playback.isPassageLooping;
  const isLoading = isPractising && playback.phase === "loading" && !playback.isPaused;
  const length = playback && playback.duration > 0 ? playback.duration : (knownDuration ?? 0);
  const currentTime = playback?.currentTime ?? 0;
  const canSeek =
    playback !== null && length > 0 && playback.phase !== "loading" && playback.phase !== "failed";

  // Follow the article as it moves from passage to passage.
  useEffect(() => {
    if (isInArticle) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [isInArticle]);

  return (
    <li ref={rowRef} className={`card practice-card passage-card ${playback ? "active" : ""}`}>
      <span className="item-number">{item.position}</span>
      <div className="practice-card-body">
        <div className="player-bar" role="group" aria-label={`Passage ${item.position}`}>
          <div className="transport">
            <button
              type="button"
              className="primary play"
              onClick={commands.togglePlay}
              title={isPractising ? "Play / Pause" : "Practice this passage on its own"}
            >
              {isLoading ? "Loading…" : isPlaying ? "❚❚ Pause" : "▶ Play"}
            </button>
            <button
              type="button"
              onClick={commands.replay}
              title="Replay from the beginning"
              aria-label="Replay from the beginning"
            >
              ↺
            </button>
          </div>

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
            title="Repeat this passage, with time to repeat it aloud in between"
          >
            ⟳ Loop passage
          </button>
        </div>

        {isTextShown && <p className="original-text">{item.text}</p>}

        {isPractising && playback.phase === "failed" && (
          <div className="banner error" role="alert">
            <span>{playback.error}</span>
            <button type="button" onClick={commands.retry}>
              Retry
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Takes the timeline's place while the learner repeats the passage aloud. */
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
