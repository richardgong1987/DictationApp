import { useEffect } from "react";
import type { ShadowingPlayer } from "./shadowingPlayer";

/**
 * Space does what the play button does, wherever focus is on the screen: pauses,
 * resumes, or starts the article. A focused button, checkbox or text field keeps
 * its own Space. A focused menu or the timeline does not: after picking a speed
 * or seeking, Space should still pause, not open the menu again.
 */
export function useSpaceToPlay(player: ShadowingPlayer) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || event.altKey || event.ctrlKey || event.metaKey) return;
      if (handlesSpaceItself(event.target)) return;
      // Space would otherwise also scroll the page.
      event.preventDefault();
      if (!event.repeat) player.toggleArticle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [player]);
}

function handlesSpaceItself(target: EventTarget | null): boolean {
  if (target instanceof HTMLButtonElement || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && target.type !== "range";
}
