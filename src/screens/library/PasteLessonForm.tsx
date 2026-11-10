import { useState, type FormEvent } from "react";

interface Props {
  isCreating: boolean;
  onCreate: (title: string, text: string) => void;
  onCancel: () => void;
}

/** A lesson from pasted text, the usual way to add one on a phone. */
export default function PasteLessonForm({ isCreating, onCreate, onCancel }: Props) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate(title, text);
  }

  return (
    <form className="card paste-lesson" onSubmit={submit}>
      <label>
        Text
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your text here. Separate passages with a blank line; each passage becomes one dictation item."
          autoFocus
        />
      </label>
      <label>
        Title <span className="muted small">(optional: taken from the first words if empty)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="actions">
        <button type="submit" className="primary" disabled={isCreating || !text.trim()}>
          {isCreating ? "Creating…" : "Create lesson"}
        </button>
        <button type="button" onClick={onCancel} disabled={isCreating}>
          Cancel
        </button>
      </div>
    </form>
  );
}
