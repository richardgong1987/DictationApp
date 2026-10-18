import { useCallback, useMemo, useState } from "react";
import { PLAYBACK_SPEEDS } from "../../api/constants";
import type { ItemDetail, Lesson } from "../../api/types";
import { useAudioUrls } from "../../audio/itemAudio";
import { EyeIcon, EyeOffIcon } from "../../components/EyeIcons";
import { formatSpeed } from "../../format";
import type { Navigate } from "../../navigation";
import ArticlePlayer from "./ArticlePlayer";
import PassageRow from "./PassageRow";
import { segmentPassage, type Segment } from "./passageSegments";
import type { RepeatPause, RepeatUnit } from "./shadowingPlayer";
import { usePassageTimings } from "./usePassageTimings";
import { useShadowingPlayer } from "./useShadowingPlayer";

const REPEAT_UNITS: { value: RepeatUnit; label: string }[] = [
  { value: "passage", label: "Whole passage" },
  { value: "sentence", label: "Sentence" },
  { value: "phrase", label: "Phrase" },
];

const REPEAT_PAUSES: { value: RepeatPause; label: string }[] = [
  { value: "none", label: "No pause" },
  { value: "threeSeconds", label: "3 seconds" },
  { value: "fiveSeconds", label: "5 seconds" },
  { value: "clipLength", label: "Match the audio's length" },
];

interface Props {
  lesson: Lesson;
  initialItems: ItemDetail[];
  navigate: Navigate;
}

/**
 * The whole article on top, and every passage below with its own player.
 * Speed and the other choices last for this visit only.
 */
export default function ShadowingSession({ lesson, initialItems, navigate }: Props) {
  const [items, setItems] = useState(initialItems);
  const [isTextShown, setIsTextShown] = useState(true);

  const updateItem = useCallback((updated: ItemDetail) => {
    setItems((list) => list.map((i) => (i.id === updated.id ? updated : i)));
  }, []);
  const audioUrlFor = useAudioUrls(updateItem);
  const { timings, timingFor } = usePassageTimings(items, audioUrlFor);
  const { state, player } = useShadowingPlayer(items, audioUrlFor, timingFor);

  const { unit } = state;
  // Kept between renders: the player re-renders the screen on every frame while audio plays.
  const segmentsById = useMemo(() => {
    const byId = new Map<number, Segment[]>();
    if (unit === "passage") return byId;
    for (const item of items) {
      const timing = timings.get(item.id);
      if (timing) byId.set(item.id, segmentPassage(item.text, timing, unit));
    }
    return byId;
  }, [items, timings, unit]);

  return (
    <main className="page shadowing">
      <button className="link" onClick={() => navigate({ name: "lesson", lessonId: lesson.id })}>
        ← {lesson.title}
      </button>
      <header className="topbar">
        <div>
          <h1>Shadowing</h1>
          <div className="muted small">
            {items.length} passages · listen and read aloud along with the audio
          </div>
        </div>
        <div className="actions">
          <label className="inline-field">
            Speed
            <select
              value={state.speed}
              onChange={(e) => player.setSpeed(Number(e.target.value))}
              aria-label="Playback speed"
            >
              {PLAYBACK_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {formatSpeed(speed)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="text-toggle"
            onClick={() => setIsTextShown((shown) => !shown)}
            aria-pressed={!isTextShown}
          >
            {isTextShown ? <EyeOffIcon /> : <EyeIcon />}
            {isTextShown ? "Hide text" : "Show text"}
          </button>
        </div>
      </header>

      <ArticlePlayer state={state} player={player} passageCount={items.length} />

      <div className="passages-heading">
        <h2>Passages</h2>
        <div className="actions">
          <label
            className="inline-field"
            title="Practice a passage whole, one sentence at a time, or in short phrases split at commas"
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
            title="Pause after each sentence or phrase, and between repetitions while looping"
          >
            Time to repeat aloud
            <select
              value={state.repeatPause}
              onChange={(e) => player.setRepeatPause(e.target.value as RepeatPause)}
            >
              {REPEAT_PAUSES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <ol className="practice-list">
        {items.map((item, index) => (
          <PassageRow
            key={item.id}
            item={item}
            playback={state.mode !== "idle" && state.index === index ? state : null}
            unit={unit}
            segments={segmentsById.get(item.id) ?? null}
            knownDuration={timings.get(item.id)?.duration}
            isTextShown={isTextShown}
            commands={{
              togglePlay: () => player.togglePassage(index),
              replay: () => player.replayPassage(index),
              toggleLoop: () => player.togglePassageLoop(index),
              playSegment: (segment) => player.playSegment(index, segment),
              seek: (seconds) => player.seek(seconds),
              retry: () => player.retry(),
            }}
          />
        ))}
      </ol>
    </main>
  );
}
