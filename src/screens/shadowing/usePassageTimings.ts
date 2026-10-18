import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { api } from "../../api/client";
import type { ItemDetail } from "../../api/types";
import type { AudioUrlFor } from "../../audio/itemAudio";
import { findPauses, type PassageTiming } from "./passageSegments";

/** Plenty for finding pauses, and a rate every WebView can decode to. */
const ANALYSIS_SAMPLE_RATE = 22050;

/** Measures where a passage's audio pauses; once per passage and visit. */
export type TimingFor = (item: ItemDetail) => Promise<PassageTiming>;

/**
 * The pauses in each passage's audio, by item id, so that its sentences and
 * phrases can be shown and played. Every passage whose audio exists is
 * measured in the background, one at a time; the player measures others
 * through `timingFor` once their audio has been generated.
 */
export function usePassageTimings(items: ItemDetail[], audioUrlFor: AudioUrlFor) {
  const [timings, setTimings] = useState<ReadonlyMap<number, PassageTiming>>(new Map());
  const requested = useRef(new Map<number, Promise<PassageTiming>>());

  const timingFor = useCallback<TimingFor>(
    (item) => {
      const known = requested.current.get(item.id);
      if (known) return known;
      // audioUrlFor generates the audio first if needed. The bytes are then read
      // again rather than fetched from the Blob URL: the app's CSP refuses that fetch.
      const timing = audioUrlFor(item)
        .then(() => api.getItemAudio(item.id))
        .then(measureTiming)
        .catch((error: unknown) => {
          // The passage still plays, only whole; say why it could not be split.
          console.error(`Could not find the pauses in passage ${item.position}:`, error);
          throw error;
        });
      requested.current.set(item.id, timing);
      timing.then(
        (measured) => setTimings((all) => new Map(all).set(item.id, measured)),
        // Forget failures so that a retry measures again.
        () => requested.current.delete(item.id),
      );
      return timing;
    },
    [audioUrlFor],
  );

  // Items that still need generating are skipped, since that would call the TTS provider.
  const readyItems = useEffectEvent(() => items.filter((item) => item.audioStatus === "ready"));
  const readyItemIds = items
    .filter((item) => item.audioStatus === "ready")
    .map((item) => item.id)
    .join();
  useEffect(() => {
    let isCancelled = false;
    (async () => {
      for (const item of readyItems()) {
        if (isCancelled) return;
        // The passage is then simply shown and played whole.
        await timingFor(item).catch(() => undefined);
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [readyItemIds, timingFor]);

  return { timings, timingFor };
}

async function measureTiming(mp3: ArrayBuffer): Promise<PassageTiming> {
  const context = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
  const audio = await context.decodeAudioData(mp3);
  return {
    duration: audio.duration,
    pauses: findPauses(audio.getChannelData(0), audio.sampleRate),
  };
}
