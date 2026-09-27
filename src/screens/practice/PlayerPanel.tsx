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
    <section className="card player" aria-label="Audio player">
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

      <div className="controls">
        <ControlButton onClick={commands.previous} disabled={!hasPrevious} title="Previous (←)">
          ⏮ Prev
        </ControlButton>
        <ControlButton onClick={commands.replay} disabled={!state.isReady} title="Replay (R)">
          ↺ Replay
        </ControlButton>
        <ControlButton
          className="primary play"
          onClick={commands.togglePlay}
          disabled={!state.isReady}
          title="Play / Pause (Space)"
        >
          {itemAudio.isLoading ? "Loading…" : state.isPlaying ? "❚❚ Pause" : "▶ Play"}
        </ControlButton>
        <ControlButton onClick={commands.next} disabled={!hasNext} title="Next (→)">
          Next ⏭
        </ControlButton>
      </div>

      <div className="controls secondary">
        <ControlButton
          className={state.isLooping ? "toggle on" : "toggle"}
          onClick={commands.toggleLoop}
          aria-pressed={state.isLooping}
          title="Loop current item (L)"
        >
          ⟳ Loop {state.isLooping ? "on" : "off"}
        </ControlButton>
        <label className="speed" title="Playback speed (↑ / ↓)">
          Speed
          <select value={state.speed} onChange={(e) => player.setSpeed(Number(e.target.value))}>
            {PLAYBACK_SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {formatSpeed(speed)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {itemAudio.error && (
        <div className="banner error">
          <span>{itemAudio.error}</span>
          <button onClick={itemAudio.retry}>Retry</button>
        </div>
      )}
    </section>
  );
}

/**
 * A player button that never takes keyboard focus, so Space and Enter keep
 * working as shortcuts after it is clicked.
 */
function ControlButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} onMouseDown={(event) => event.preventDefault()} />;
}
