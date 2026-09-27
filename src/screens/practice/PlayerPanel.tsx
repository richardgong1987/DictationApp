import type { ButtonHTMLAttributes } from "react";
import { PLAYBACK_SPEEDS } from "../../api/constants";
import { formatSpeed, formatTime } from "../../format";
import type { AudioPlayer } from "./useAudioPlayer";
import type { ItemAudio } from "./useItemAudio";
import type { PracticeCommands } from "./usePracticeShortcuts";

interface Props {
  player: AudioPlayer;
  itemAudio: ItemAudio;
  commands: PracticeCommands;
  hasPrevious: boolean;
  hasNext: boolean;
}

export default function PlayerPanel({ player, itemAudio, commands, hasPrevious, hasNext }: Props) {
  const { state } = player;
  const duration = state.duration || 0;

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
          disabled={!state.isReady}
          title="Play / Pause (Space)"
        >
          {itemAudio.isLoading ? "Loading…" : state.isPlaying ? "❚❚ Pause" : "▶ Play"}
        </ControlButton>
        <ControlButton
          onClick={commands.replay}
          disabled={!state.isReady}
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
        <span className="time">{formatTime(state.currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.05}
          value={Math.min(state.currentTime, duration)}
          onChange={(e) => player.seek(Number(e.target.value))}
          disabled={!state.isReady}
          aria-label="Seek"
        />
        <span className="time">{formatTime(duration)}</span>
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

      {itemAudio.error && (
        <div className="banner error">
          <span>{itemAudio.error}</span>
          <button onClick={itemAudio.retry}>Retry</button>
        </div>
      )}
    </div>
  );
}

/**
 * A player button that never takes keyboard focus, so Space and Enter keep
 * working as shortcuts after it is clicked.
 */
function ControlButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} onMouseDown={(event) => event.preventDefault()} />;
}
