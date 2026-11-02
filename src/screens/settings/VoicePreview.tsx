import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { TtsProvider } from "../../api/types";

/** Where hearing a voice stands. */
type PreviewState =
  | { status: "idle" }
  | { status: "loading" | "playing"; voiceId: string }
  | { status: "failed"; voiceId: string; error: string };

interface VoicePreviewProps {
  provider: TtsProvider;
  voiceId: string;
  /** The provider's own recording of the voice, if its list gave one. */
  previewUrl: string | null;
  /** What it costs when the voice has to say a sentence instead. */
  spokenSampleCost: string;
}

/** A button to hear the chosen voice, and what hearing it costs. */
export default function VoicePreview({ provider, voiceId, previewUrl, spokenSampleCost }: VoicePreviewProps) {
  const { state, play, stop } = useVoicePreview(provider);
  const isThisVoice = state.status !== "idle" && state.voiceId === voiceId;
  const status = isThisVoice ? state.status : "idle";

  return (
    <div className="actions">
      <button
        type="button"
        disabled={status === "loading"}
        onClick={() => (status === "playing" ? stop() : play(voiceId, previewUrl))}
      >
        {status === "loading" ? "Loading…" : status === "playing" ? "■ Stop" : "▶ Listen"}
      </button>
      <span className="muted small">
        {state.status === "failed" && isThisVoice
          ? `Could not play it: ${state.error}`
          : previewUrl
            ? `Plays the sample ${providerName(provider)} keeps of this voice, at no cost.`
            : `${spokenSampleCost} Replaying it is free.`}
      </span>
    </div>
  );
}

function providerName(provider: TtsProvider): string {
  return { azure: "Azure", elevenlabs: "ElevenLabs", gemini: "Gemini" }[provider];
}

/**
 * Plays voice samples for one provider. Each voice's sample is fetched once
 * per visit to Settings, because a spoken sample costs a request.
 */
function useVoicePreview(provider: TtsProvider) {
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const samples = useRef(new Map<string, string>());
  const player = useRef<HTMLAudioElement | null>(null);
  // A later click wins over a sample that is still loading.
  const latestRequest = useRef(0);

  useEffect(() => {
    const urls = samples.current;
    return () => {
      player.current?.pause();
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, []);

  function stop() {
    latestRequest.current++;
    player.current?.pause();
    setState({ status: "idle" });
  }

  async function play(voiceId: string, previewUrl: string | null) {
    const request = ++latestRequest.current;
    player.current?.pause();
    setState({ status: "loading", voiceId });
    try {
      const url = samples.current.get(voiceId) ?? (await fetchSample(provider, voiceId, previewUrl));
      samples.current.set(voiceId, url);
      if (request !== latestRequest.current) return;
      const audio = new Audio(url);
      player.current = audio;
      audio.onended = () => {
        if (player.current === audio) setState({ status: "idle" });
      };
      await audio.play();
      setState({ status: "playing", voiceId });
    } catch (e) {
      if (request === latestRequest.current) setState({ status: "failed", voiceId, error: errorMessage(e) });
    }
  }

  return { state, play, stop };
}

async function fetchSample(provider: TtsProvider, voiceId: string, previewUrl: string | null) {
  const bytes = await api.previewVoice(provider, voiceId, previewUrl);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}
