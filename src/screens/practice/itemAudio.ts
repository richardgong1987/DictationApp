import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { ItemDetail } from "../../api/types";
import type { AudioPlayer } from "./useAudioPlayer";

/** Resolves an item's audio to a playable Blob URL. */
export type AudioUrlFor = (item: ItemDetail) => Promise<string>;

/**
 * Item audio as Blob URLs, fetched once per session and revoked on unmount.
 * Missing or outdated audio is generated first; cached audio never calls Azure.
 */
export function useAudioUrls(onItemUpdated: (item: ItemDetail) => void): AudioUrlFor {
  const urls = useRef(new Map<number, Promise<string>>());

  useEffect(() => {
    const cache = urls.current;
    return () => {
      for (const url of cache.values()) url.then(URL.revokeObjectURL, () => undefined);
      cache.clear();
    };
  }, []);

  return useCallback(
    (item: ItemDetail): Promise<string> => {
      const cached = urls.current.get(item.id);
      if (cached) return cached;
      const url = fetchAudioUrl(item, onItemUpdated);
      urls.current.set(item.id, url);
      // Forget failures so that a retry fetches again.
      url.catch(() => urls.current.delete(item.id));
      return url;
    },
    [onItemUpdated],
  );
}

export interface CurrentItemAudio {
  /** The audio is being fetched or generated. */
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

/** Loads the current item's audio into the player and starts playing it. */
export function useCurrentItemAudio(
  item: ItemDetail,
  player: AudioPlayer,
  audioUrlFor: AudioUrlFor,
): CurrentItemAudio {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const latestLoadId = useRef(0);
  const { load } = player;

  // Reads the latest item without restarting playback when only its details change.
  const currentItem = useEffectEvent(() => item);

  useEffect(() => {
    const loadId = ++latestLoadId.current;
    const isSuperseded = () => loadId !== latestLoadId.current;
    setError(null);
    setIsLoading(true);
    load(null, false);

    audioUrlFor(currentItem())
      .then((url) => {
        if (isSuperseded()) return;
        load(url, true);
        setIsLoading(false);
      })
      .catch((e) => {
        if (isSuperseded()) return;
        setIsLoading(false);
        setError(errorMessage(e));
      });
  }, [item.id, retryCount, audioUrlFor, load]);

  const retry = useCallback(() => setRetryCount((count) => count + 1), []);
  return { isLoading, error, retry };
}

/**
 * Length in seconds, by item id, of every item whose audio already exists.
 * Fetching them one at a time also means each item starts without a wait.
 * Items that still need generating are skipped, since that would call Azure.
 */
export function useAudioDurations(
  items: ItemDetail[],
  audioUrlFor: AudioUrlFor,
): ReadonlyMap<number, number> {
  const [durations, setDurations] = useState<ReadonlyMap<number, number>>(new Map());
  const readyItemsWithoutDuration = useEffectEvent(() =>
    items.filter((item) => item.audioStatus === "ready" && !durations.has(item.id)),
  );

  const readyItemIds = items
    .filter((item) => item.audioStatus === "ready")
    .map((item) => item.id)
    .join();
  useEffect(() => {
    let isCancelled = false;
    (async () => {
      for (const item of readyItemsWithoutDuration()) {
        if (isCancelled) return;
        try {
          const seconds = await readDuration(await audioUrlFor(item));
          if (isCancelled) return;
          setDurations((known) => new Map(known).set(item.id, seconds));
        } catch {
          // The item simply shows no length.
        }
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [readyItemIds, audioUrlFor]);

  return durations;
}

async function fetchAudioUrl(
  item: ItemDetail,
  onItemUpdated: (item: ItemDetail) => void,
): Promise<string> {
  if (item.audioStatus !== "ready") {
    try {
      onItemUpdated(await api.generateItemAudio(item.id, false));
    } catch (error) {
      // Audio made with an older voice is still worth playing.
      if (item.audioStatus === "missing") throw error;
    }
  }
  const bytes = await api.getItemAudio(item.id);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

/** Reads an MP3's length from its metadata, without playing it. */
function readDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = new Audio();
    probe.preload = "metadata";
    probe.onloadedmetadata = () =>
      Number.isFinite(probe.duration)
        ? resolve(probe.duration)
        : reject(new Error("Unknown duration"));
    probe.onerror = () => reject(probe.error);
    probe.src = url;
  });
}
