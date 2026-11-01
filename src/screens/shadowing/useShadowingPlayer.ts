import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../../api/client";
import type { ItemDetail, ShadowingPosition } from "../../api/types";
import type { AudioUrlFor } from "../../audio/itemAudio";
import { segmentPassage } from "./passageSegments";
import { isRunning, ShadowingPlayer, type ArticlePlace, type Timers } from "./shadowingPlayer";
import type { TimingFor } from "./usePassageTimings";

const BROWSER_TIMERS: Timers = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

interface PlayerSource {
  lessonId: string;
  items: ItemDetail[];
  audioUrlFor: AudioUrlFor;
  timingFor: TimingFor;
  /** Where an earlier visit stopped; read once, when the player is created. */
  savedPosition: ShadowingPosition | null;
}

/**
 * The shadowing screen's one player, with its state for rendering. It keeps
 * the learner's place as they go. Leaving the screen stops playback and
 * cancels the countdown and pending loads.
 */
export function useShadowingPlayer({
  lessonId,
  items,
  audioUrlFor,
  timingFor,
  savedPosition,
}: PlayerSource) {
  // The player asks for audio long after rendering; it should see the latest items.
  const latest = useRef({ items, audioUrlFor, timingFor });
  useEffect(() => {
    latest.current = { items, audioUrlFor, timingFor };
  }, [items, audioUrlFor, timingFor]);

  const [player] = useState(
    () =>
      new ShadowingPlayer({
        audio: createAudio(),
        timers: BROWSER_TIMERS,
        passageCount: items.length,
        passageUrl: (index) => latest.current.audioUrlFor(latest.current.items[index]),
        passageClips: async (index, unit) => {
          const item = latest.current.items[index];
          try {
            const timing = await latest.current.timingFor(item);
            return segmentPassage(item.text, timing, unit).map((segment) => segment.clip);
          } catch {
            // Unmeasured audio plays whole; a failed load is reported through passageUrl.
            return [];
          }
        },
        resumeFrom: placeOf(savedPosition, items),
        onPlaceReached: (place) => keepPlace(lessonId, latest.current.items, place),
      }),
  );
  const state = useSyncExternalStore(player.subscribe, player.getState);

  useEffect(() => () => player.stop(), [player]);

  // Smooth time and countdown display; media events alone come only a few times a second.
  const isTicking = isRunning(state) && state.phase !== "loading";
  useEffect(() => {
    if (!isTicking) return;
    let frame = requestAnimationFrame(function tick() {
      player.sample();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [player, isTicking]);

  return { state, player };
}

/** Audio generated anew has its own timing, so without audio only the passage still holds. */
function placeOf(position: ShadowingPosition | null, items: ItemDetail[]): ArticlePlace | null {
  if (!position) return null;
  const index = items.findIndex((item) => item.id === position.itemId);
  if (index < 0) return null;
  const isAudioKept = items[index].audioStatus === "ready";
  return { index, seconds: isAudioKept ? position.audioSeconds : 0 };
}

/** Practice goes on when the place cannot be saved; the next part tries again. */
function keepPlace(lessonId: string, items: ItemDetail[], place: ArticlePlace | null) {
  const saved = place
    ? api.saveShadowingPosition(items[place.index].id, place.seconds)
    : api.clearShadowingPosition(lessonId);
  saved.catch((error: unknown) => console.error("Could not save the shadowing position:", error));
}

function createAudio(): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = "auto";
  audio.preservesPitch = true;
  return audio;
}
