import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { errorMessage } from "../../api/client";
import type { ItemDetail } from "../../api/types";
import type { AudioUrlFor } from "../../audio/itemAudio";
import type { AudioPlayer } from "./useAudioPlayer";

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
