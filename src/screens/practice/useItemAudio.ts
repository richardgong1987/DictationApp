import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { ItemDetail } from "../../api/types";
import type { AudioPlayer } from "./useAudioPlayer";

interface Options {
  items: ItemDetail[];
  index: number;
  player: AudioPlayer;
  /** Receives an item whose audio was generated on demand. */
  onItemUpdated: (item: ItemDetail) => void;
}

export interface ItemAudio {
  /** The current item's audio is being fetched or generated. */
  isLoading: boolean;
  error: string | null;
  retry: () => void;
  /** Length in seconds, by item id, for audio fetched so far. */
  durations: ReadonlyMap<number, number>;
}

/**
 * Loads the current item's audio into the player. Missing or outdated audio
 * is generated first; cached audio never calls Azure. Audio that is already
 * generated is fetched for every item, so each one shows its length and starts
 * without a wait.
 */
export function useItemAudio({ items, index, player, onItemUpdated }: Options): ItemAudio {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [durations, setDurations] = useState<ReadonlyMap<number, number>>(new Map());
  const audioUrlFor = useAudioUrlCache(onItemUpdated);
  const latestLoadId = useRef(0);
  const { load } = player;

  // Read the latest items without restarting playback whenever one changes.
  const itemAt = useEffectEvent((position: number): ItemDetail | undefined => items[position]);
  const readyItemsWithoutDuration = useEffectEvent(() =>
    items.filter((item) => item.audioStatus === "ready" && !durations.has(item.id)),
  );

  useEffect(() => {
    const loadId = ++latestLoadId.current;
    const isSuperseded = () => loadId !== latestLoadId.current;
    setError(null);
    setIsLoading(true);
    load(null, false);

    audioUrlFor(itemAt(index)!)
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
  }, [index, retryCount, audioUrlFor, load]);

  // One at a time, and never for items whose audio still has to be generated.
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

  const retry = useCallback(() => setRetryCount((count) => count + 1), []);
  return { isLoading, error, retry, durations };
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

/** Blob URLs per item id, kept for the session and revoked on unmount. */
function useAudioUrlCache(onItemUpdated: (item: ItemDetail) => void) {
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
