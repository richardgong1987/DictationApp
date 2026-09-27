import { useEffect, useEffectEvent } from "react";

export type PracticeCommand =
  | "togglePlay"
  | "replay"
  | "toggleLoop"
  | "previous"
  | "next"
  | "faster"
  | "slower"
  | "submit";

/** What each command does; shared by keyboard shortcuts and on-screen buttons. */
export type PracticeCommands = Record<PracticeCommand, () => void>;

export interface ShortcutContext {
  /** The key was pressed while a text field had focus. */
  isTyping: boolean;
}

interface KeyBinding {
  command: PracticeCommand;
  /** Holding the key down repeats the command. */
  isRepeatable: boolean;
}

/** Plain keys outside text fields; inside them the same keys need Ctrl/⌘. */
const KEY_BINDINGS: Record<string, KeyBinding> = {
  " ": { command: "togglePlay", isRepeatable: false },
  r: { command: "replay", isRepeatable: false },
  l: { command: "toggleLoop", isRepeatable: false },
  ArrowLeft: { command: "previous", isRepeatable: true },
  ArrowRight: { command: "next", isRepeatable: true },
  ArrowUp: { command: "faster", isRepeatable: true },
  ArrowDown: { command: "slower", isRepeatable: true },
};

const NON_TEXT_INPUT_TYPES = new Set(["range", "checkbox", "button"]);

/**
 * Turns key presses into practice commands without getting in the way of
 * typing: in a text field only Enter and Ctrl/⌘ combinations act, Shift+Enter
 * stays a line break and Esc leaves the field.
 */
export function usePracticeShortcuts(
  onCommand: (command: PracticeCommand, context: ShortcutContext) => void,
) {
  const runCommand = useEffectEvent(onCommand);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const isTyping = isTextField(target);
      // A focused button handles its own Enter and Space presses.
      const isOnButton = target instanceof HTMLButtonElement;

      if (event.key === "Enter") {
        if (event.shiftKey || isOnButton) return;
        event.preventDefault();
        runCommand("submit", { isTyping });
        return;
      }
      if (event.key === "Escape" && isTyping) {
        target.blur();
        return;
      }
      if (isTyping && !(event.ctrlKey || event.metaKey)) return;

      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === " " && isOnButton) return;
      const binding = KEY_BINDINGS[key];
      if (!binding) return;
      event.preventDefault();
      if (event.repeat && !binding.isRepeatable) return;
      runCommand(binding.command, { isTyping });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

function isTextField(
  element: HTMLElement | null,
): element is HTMLTextAreaElement | HTMLInputElement {
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type))
  );
}
