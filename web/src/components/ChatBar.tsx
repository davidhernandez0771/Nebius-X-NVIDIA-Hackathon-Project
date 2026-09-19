import type { FormEvent } from "react";
import Icon from "./Icon";

type Props = {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  placeholder?: string;
  hint?: string; // e.g. the assistant's last reply, shown above the bar
  error?: string;
};

// The chat command bar, docked at the bottom of the right panel
// (the "music player bar" of the reference).
export default function ChatBar({ value, onChange, onSubmit, busy, placeholder, hint, error }: Props) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form className="chat-bar" onSubmit={handleSubmit}>
      {error ? (
        <p className="chat-bar-note chat-bar-note--error" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="chat-bar-note">{hint}</p>
      )}
      <div className="chat-bar-row">
        <input
          type="text"
          aria-label="Command"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
        />
        <button type="submit" className="chat-bar-send" aria-label="Send" disabled={busy || !value.trim()}>
          <Icon name="send" size={20} />
        </button>
      </div>
    </form>
  );
}
