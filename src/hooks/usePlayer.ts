import { useCallback, useEffect, useRef, useState } from "react";

export interface PlayerState {
  playing: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  loop: boolean;
  /** A source is loaded and can be played. */
  ready: boolean;
}

/**
 * Owns one HTMLAudioElement for the practice screen. All playback happens
 * locally in the WebView; Rust only supplies the MP3 bytes.
 */
export function usePlayer(initialSpeed: number, initialLoop: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (audioRef.current === null) {
    const audio = new Audio();
    audio.preload = "auto";
    audio.preservesPitch = true;
    audioRef.current = audio;
  }

  const [state, setState] = useState<PlayerState>({
    playing: false,
    currentTime: 0,
    duration: 0,
    speed: initialSpeed,
    loop: initialLoop,
    ready: false,
  });

  useEffect(() => {
    const audio = audioRef.current!;
    audio.playbackRate = state.speed;
    audio.defaultPlaybackRate = state.speed;
  }, [state.speed]);

  useEffect(() => {
    audioRef.current!.loop = state.loop;
  }, [state.loop]);

  useEffect(() => {
    const audio = audioRef.current!;
    let frame = 0;
    const sync = () =>
      setState((s) => ({
        ...s,
        playing: !audio.paused,
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
      setState((s) => ({ ...s, ready: true }));
      sync();
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", sync);
    audio.addEventListener("ended", sync);
    audio.addEventListener("seeked", sync);
    audio.addEventListener("durationchange", sync);
    audio.addEventListener("loadedmetadata", onLoaded);
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", sync);
      audio.removeEventListener("ended", sync);
      audio.removeEventListener("seeked", sync);
      audio.removeEventListener("durationchange", sync);
      audio.removeEventListener("loadedmetadata", onLoaded);
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

  const load = useCallback(
    (url: string | null, autoplay: boolean) => {
      const audio = audioRef.current!;
      audio.pause();
      setState((s) => ({ ...s, ready: false, playing: false, currentTime: 0, duration: 0 }));
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

  const pause = useCallback(() => audioRef.current!.pause(), []);

  /** Returns true when playback (re)started from the beginning. */
  const toggle = useCallback((): boolean => {
    const audio = audioRef.current!;
    if (!audio.src) return false;
    if (audio.paused) {
      const fromStart = audio.ended || audio.currentTime === 0;
      if (audio.ended) audio.currentTime = 0;
      play();
      return fromStart;
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
  const setLoop = useCallback((loop: boolean) => setState((s) => ({ ...s, loop })), []);

  return { state, load, play, pause, toggle, replay, seek, setSpeed, setLoop };
}
