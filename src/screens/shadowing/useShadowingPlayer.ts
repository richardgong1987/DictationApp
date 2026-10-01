import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ItemDetail } from "../../api/types";
import type { AudioUrlFor } from "../../audio/itemAudio";
import { isRunning, ShadowingPlayer, type Timers } from "./shadowingPlayer";

const BROWSER_TIMERS: Timers = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

/**
 * The shadowing screen's one player, with its state for rendering. Leaving
 * the screen stops playback and cancels the countdown and pending loads.
 */
export function useShadowingPlayer(items: ItemDetail[], audioUrlFor: AudioUrlFor) {
  // The player asks for audio long after rendering; it should see the latest items.
  const latest = useRef({ items, audioUrlFor });
  useEffect(() => {
    latest.current = { items, audioUrlFor };
  }, [items, audioUrlFor]);

  const [player] = useState(
    () =>
      new ShadowingPlayer({
        audio: createAudio(),
        timers: BROWSER_TIMERS,
        passageCount: items.length,
        passageUrl: (index) => latest.current.audioUrlFor(latest.current.items[index]),
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

function createAudio(): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = "auto";
  audio.preservesPitch = true;
  return audio;
}
