import { useEffect } from "react";
import type { ShadowingPlayer } from "./shadowingPlayer";

/**
 * Each key does what its button on the player does, the same keys as in Dictation.
 * Keep in sync with the button titles in ArticlePlayer.tsx.
 */
const KEY_COMMANDS: Record<string, (player: ShadowingPlayer) => void> = {
  " ": (player) => player.toggleArticle(),
  ArrowLeft: (player) => player.previousSegment(),
  ArrowRight: (player) => player.nextSegment(),
  r: (player) => player.replaySegment(),
  l: (player) => player.toggleLoop(),
};

/**
 * The player's keyboard shortcuts, wherever focus is on the screen. A focused
 * menu or the timeline does not keep the keys: after picking a speed or
 * seeking, they should still drive the player.
 */
export function useShadowingShortcuts(player: ShadowingPlayer) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const command = KEY_COMMANDS[key];
      if (!command || keepsKey(event.target, key)) return;
      // Space and the arrows would otherwise also scroll the page.
      event.preventDefault();
      // A held key does not repeat: every step loads a passage's audio, or even generates it.
      if (!event.repeat) command(player);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [player]);
}

/** A focused text box keeps every key, and a focused button its Space, which presses it. */
function keepsKey(target: EventTarget | null, key: string): boolean {
  const isTextBox =
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && target.type !== "range");
  return isTextBox || (key === " " && target instanceof HTMLButtonElement);
}
