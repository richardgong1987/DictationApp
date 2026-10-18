import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
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
      const timing = audioUrlFor(item).then(measureTiming);
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

async function measureTiming(url: string): Promise<PassageTiming> {
  const response = await fetch(url);
  const context = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
  const audio = await context.decodeAudioData(await response.arrayBuffer());
  return {
    duration: audio.duration,
    pauses: findPauses(audio.getChannelData(0), audio.sampleRate),
  };
}
