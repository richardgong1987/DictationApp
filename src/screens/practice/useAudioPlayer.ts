import { useCallback, useEffect, useRef, useState } from "react";
import { PLAYBACK_SPEEDS } from "../../api/constants";

const DEFAULT_SPEED = 1;

/** Saved in Settings so the next session starts where this one left off. */
export interface PlayerPreferences {
  speed: number;
  isLooping: boolean;
}

export interface PlayerState {
  isPlaying: boolean;
  /** A source is loaded and can be played. */
  isReady: boolean;
  isLooping: boolean;
  currentTime: number;
  duration: number;
  speed: number;
}

export type AudioPlayer = ReturnType<typeof useAudioPlayer>;

/**
 * Owns one HTMLAudioElement for the practice screen. All playback happens
 * locally in the WebView; Rust only supplies the MP3 bytes.
 */
export function useAudioPlayer(preferences: PlayerPreferences) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (audioRef.current === null) {
    const audio = new Audio();
    audio.preload = "auto";
    audio.preservesPitch = true;
    audioRef.current = audio;
  }

  const [state, setState] = useState<PlayerState>({
    isPlaying: false,
    isReady: false,
    isLooping: preferences.isLooping,
    currentTime: 0,
    duration: 0,
    speed: preferences.speed,
  });

  useEffect(() => {
    const audio = audioRef.current!;
    audio.playbackRate = state.speed;
    audio.defaultPlaybackRate = state.speed;
  }, [state.speed]);

  useEffect(() => {
    audioRef.current!.loop = state.isLooping;
  }, [state.isLooping]);

  useEffect(() => {
    const audio = audioRef.current!;
    let frame = 0;
    const sync = () =>
      setState((s) => ({
        ...s,
        isPlaying: !audio.paused,
        currentTime: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      }));
    // Smooth time display while playing; timeupdate alone is only ~4 Hz.
    const tick = () => {
      sync();
      if (!audio.paused) frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const onLoaded = () => {
      setState((s) => ({ ...s, isReady: true }));
      sync();
    };
    const listeners: [keyof HTMLMediaElementEventMap, () => void][] = [
      ["play", onPlay],
      ["pause", sync],
      ["ended", sync],
      ["seeked", sync],
      ["durationchange", sync],
      ["loadedmetadata", onLoaded],
    ];
    for (const [event, listener] of listeners) audio.addEventListener(event, listener);
    return () => {
      cancelAnimationFrame(frame);
      for (const [event, listener] of listeners) audio.removeEventListener(event, listener);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, []);

  const play = useCallback(() => {
    const audio = audioRef.current!;
    if (!audio.src) return;
    audio.playbackRate = audio.defaultPlaybackRate;
    // play() rejects when interrupted by a new load; that is expected.
    audio.play().catch(() => undefined);
  }, []);

  /** Switches to another source (`null` unloads) and optionally starts it. */
  const load = useCallback(
    (url: string | null, autoplay: boolean) => {
      const audio = audioRef.current!;
      audio.pause();
      setState((s) => ({ ...s, isReady: false, isPlaying: false, currentTime: 0, duration: 0 }));
      if (url === null) {
        audio.removeAttribute("src");
        audio.load();
        return;
      }
      audio.src = url;
      audio.load();
      if (autoplay) play();
    },
    [play],
  );

  /** Returns true when playback (re)started from the beginning. */
  const toggle = useCallback((): boolean => {
    const audio = audioRef.current!;
    if (!audio.src) return false;
    if (audio.paused) {
      const isFromStart = audio.ended || audio.currentTime === 0;
      if (audio.ended) audio.currentTime = 0;
      play();
      return isFromStart;
    }
    audio.pause();
    return false;
  }, [play]);

  const replay = useCallback(() => {
    const audio = audioRef.current!;
    if (!audio.src) return;
    audio.currentTime = 0;
    play();
  }, [play]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current!;
    if (!audio.src || !Number.isFinite(time)) return;
    audio.currentTime = Math.max(0, Math.min(time, audio.duration || 0));
    setState((s) => ({ ...s, currentTime: audio.currentTime }));
  }, []);

  const setSpeed = useCallback((speed: number) => setState((s) => ({ ...s, speed })), []);

  /** Moves `steps` places along the offered speeds (negative is slower). */
  const stepSpeed = useCallback(
    (steps: number) => setState((s) => ({ ...s, speed: stepPlaybackSpeed(s.speed, steps) })),
    [],
  );

  const toggleLoop = useCallback(() => setState((s) => ({ ...s, isLooping: !s.isLooping })), []);

  return { state, load, toggle, replay, seek, setSpeed, stepSpeed, toggleLoop };
}

function stepPlaybackSpeed(speed: number, steps: number): number {
  const current = PLAYBACK_SPEEDS.findIndex((offered) => Math.abs(offered - speed) < 1e-6);
  const from = current < 0 ? PLAYBACK_SPEEDS.indexOf(DEFAULT_SPEED) : current;
  const to = Math.min(Math.max(from + steps, 0), PLAYBACK_SPEEDS.length - 1);
  return PLAYBACK_SPEEDS[to];
}
