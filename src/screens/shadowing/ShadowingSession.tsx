import { useCallback, useMemo, useState } from "react";
import { PLAYBACK_SPEEDS } from "../../api/constants";
import type { ItemDetail, Lesson } from "../../api/types";
import { useAudioUrls } from "../../audio/itemAudio";
import { EyeIcon, EyeOffIcon } from "../../components/EyeIcons";
import PageHeader from "../../components/PageHeader";
import { formatSpeed } from "../../format";
import type { Navigate } from "../../navigation";
import ArticlePlayer from "./ArticlePlayer";
import ArticleText from "./ArticleText";
import { segmentPassage, type Segment } from "./passageSegments";
import { isUnderway } from "./shadowingPlayer";
import { usePassageTimings } from "./usePassageTimings";
import { useShadowingPlayer } from "./useShadowingPlayer";

interface Props {
  lesson: Lesson;
  initialItems: ItemDetail[];
  navigate: Navigate;
}

/**
 * The player stays at the top of the window, above the whole article.
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

  const playSegment = useCallback(
    (index: number, segment: number) => player.playSegment(index, segment),
    [player],
  );
  const currentItem = items[state.index];

  return (
    <main className="page shadowing">
      <PageHeader>
        <button className="link" onClick={() => navigate({ name: "lesson", lessonId: lesson.id })}>
          ← {lesson.title}
        </button>
        <div className="topbar">
          <div className="wide-only">
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
        </div>
        <ArticlePlayer
          state={state}
          player={player}
          passageCount={items.length}
          segmentCount={segmentsById.get(currentItem.id)?.length ?? 1}
          knownDuration={timings.get(currentItem.id)?.duration}
        />
      </PageHeader>

      {isTextShown ? (
        <ArticleText
          items={items}
          segmentsById={segmentsById}
          unit={unit}
          currentIndex={isUnderway(state) ? state.index : null}
          currentSegment={state.segment}
          playSegment={playSegment}
        />
      ) : (
        <p className="muted">The text is hidden. The player above still moves through it.</p>
      )}
    </main>
  );
}
