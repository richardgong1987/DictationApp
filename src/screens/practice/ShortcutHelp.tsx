/** Keep in sync with the bindings in usePracticeShortcuts.ts. */
export default function ShortcutHelp() {
  return (
    <details className="shortcuts muted small">
      <summary>Keyboard shortcuts</summary>
      <p>
        Outside the answer box: <kbd>Space</kbd> play/pause · <kbd>R</kbd> replay · <kbd>←</kbd>/
        <kbd>→</kbd> previous/next · <kbd>L</kbd> loop · <kbd>↑</kbd>/<kbd>↓</kbd> speed ·{" "}
        <kbd>Enter</kbd> check answer / next item.
      </p>
      <p>
        While typing: hold <kbd>Ctrl</kbd> (<kbd>⌘</kbd> on macOS) with the same keys, e.g.{" "}
        <kbd>Ctrl</kbd>+<kbd>Space</kbd> or <kbd>Ctrl</kbd>+<kbd>R</kbd>. <kbd>Enter</kbd> checks,{" "}
        <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line break, <kbd>Esc</kbd> leaves the answer box.
      </p>
    </details>
  );
}
