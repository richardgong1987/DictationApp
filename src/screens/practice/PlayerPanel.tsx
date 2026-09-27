import { PLAYBACK_SPEEDS } from "../../api/constants";
import { formatSpeed, formatTime } from "../../format";
import ControlButton from "./ControlButton";
import type { AudioPlayer } from "./useAudioPlayer";
import type { ItemAudio } from "./useItemAudio";
import type { PracticeCommands } from "./usePracticeShortcuts";

export type PlayerCommands = Pick<
  PracticeCommands,
  "togglePlay" | "replay" | "previous" | "next" | "toggleLoop"
>;

interface Props {
  /** The one player shared by all cards. */
  player: AudioPlayer;
  /** This card's item is the one loaded in the player. */
  isActive: boolean;
  /** Length of this card's audio, once known. */
  duration: number | undefined;
  itemAudio: ItemAudio;
  commands: PlayerCommands;
  hasPrevious: boolean;
  hasNext: boolean;
}

/**
 * Audio controls for one card. Loop and speed are shared by all cards; only
 * the active card shows playback progress, and pressing Play on another card
 * makes that card active.
 */
export default function PlayerPanel({
  player,
  isActive,
  duration,
  itemAudio,
  commands,
  hasPrevious,
  hasNext,
}: Props) {
  const { state } = player;
  const isLoadingAudio = isActive && itemAudio.isLoading;
  const canPlay = !isActive || state.isReady;
  const currentTime = isActive ? state.currentTime : 0;
  const length = isActive && state.duration > 0 ? state.duration : (duration ?? 0);

  return (
    <div className="player-bar" role="group" aria-label="Audio player">
      <div className="transport">
        <ControlButton
          onClick={commands.previous}
          disabled={!hasPrevious}
          title="Previous item (←)"
          aria-label="Previous item"
        >
          ⏮
        </ControlButton>
        <ControlButton
          className="primary play"
          onClick={commands.togglePlay}
          disabled={!canPlay}
          title="Play / Pause (Space)"
        >
          {isLoadingAudio ? "Loading…" : isActive && state.isPlaying ? "❚❚ Pause" : "▶ Play"}
        </ControlButton>
        <ControlButton
          onClick={commands.replay}
          disabled={!canPlay}
          title="Replay (R)"
          aria-label="Replay"
        >
          ↺
        </ControlButton>
        <ControlButton
          onClick={commands.next}
          disabled={!hasNext}
          title="Next item (→)"
          aria-label="Next item"
        >
          ⏭
        </ControlButton>
      </div>

      <div className="timeline">
        <span className="time">{formatTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={length}
          step={0.05}
          value={Math.min(currentTime, length)}
          onChange={(e) => player.seek(Number(e.target.value))}
          disabled={!isActive || !state.isReady}
          aria-label="Seek"
        />
        <span className="time">{length > 0 ? formatTime(length) : "--:--.-"}</span>
      </div>

      <ControlButton
        className={state.isLooping ? "toggle on" : "toggle"}
        onClick={commands.toggleLoop}
        aria-pressed={state.isLooping}
        title="Loop current item (L)"
      >
        ⟳ Loop
      </ControlButton>
      <select
        value={state.speed}
        onChange={(e) => player.setSpeed(Number(e.target.value))}
        title="Playback speed (↑ / ↓)"
        aria-label="Playback speed"
      >
        {PLAYBACK_SPEEDS.map((speed) => (
          <option key={speed} value={speed}>
            {formatSpeed(speed)}
          </option>
        ))}
      </select>

      {isActive && itemAudio.error && (
        <div className="banner error">
          <span>{itemAudio.error}</span>
          <button onClick={itemAudio.retry}>Retry</button>
        </div>
      )}
    </div>
  );
}
