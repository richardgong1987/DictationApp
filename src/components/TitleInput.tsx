import { useEffect, useRef, useState } from "react";

interface Props {
  initialTitle: string;
  /** Called only when the title was actually changed. */
  onSave: (title: string) => void;
  onCancel: () => void;
}

/**
 * Edits a title in place. Enter or clicking elsewhere saves; Escape, or
 * leaving the title as it was, cancels.
 */
export default function TitleInput({ initialTitle, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  // Removing a focused input fires blur, which would save right after
  // Enter or Escape has already finished the edit.
  const isFinished = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function finish(save: boolean) {
    if (isFinished.current) return;
    isFinished.current = true;
    if (save && title !== initialTitle) onSave(title);
    else onCancel();
  }

  return (
    <input
      ref={inputRef}
      className="title-input"
      aria-label="Lesson title"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        // WebKit reports the Enter that picks an IME candidate (e.g. Chinese
        // pinyin) with isComposing false but keyCode 229; it must not save.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
    />
  );
}
