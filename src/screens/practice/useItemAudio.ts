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
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Loads the current item's audio into the player, then prefetches the next
 * item's. Missing or outdated audio is generated first; cached audio never
 * calls Azure.
 */
export function useItemAudio({ items, index, player, onItemUpdated }: Options): ItemAudio {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const audioUrlFor = useAudioUrlCache(onItemUpdated);
  const latestLoadId = useRef(0);
  const { load } = player;

  // Reads the latest items without restarting playback whenever one changes.
  const itemAt = useEffectEvent((position: number): ItemDetail | undefined => items[position]);

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
        const next = itemAt(index + 1);
        if (next?.audioStatus === "ready") audioUrlFor(next).catch(() => undefined);
      })
      .catch((e) => {
        if (isSuperseded()) return;
        setIsLoading(false);
        setError(errorMessage(e));
      });
  }, [index, retryCount, audioUrlFor, load]);

  const retry = useCallback(() => setRetryCount((count) => count + 1), []);
  return { isLoading, error, retry };
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
