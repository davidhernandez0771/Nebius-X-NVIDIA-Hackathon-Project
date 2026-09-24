import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Icon from "../components/Icon";
// Read-only import of Worker 1's module -- see SANT_VOICE_MODES_PLAN.md §4.
// Coded against the frozen UseDictation contract in ../voice/types.ts;
// `active` is the only control surface used here (Worker 1's
// implementation starts/stops the mic session internally in response to
// it), the returned start()/stop() are left unused by design.
import { useDictation } from "../voice/dictation";

type Props = {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onCancel: () => void;
  sending: boolean;
  placeholder?: string;
};

export default function MessageComposer({ value, onChange, onSend, onCancel, sending, placeholder }: Props) {
  const [micOn, setMicOn] = useState(false);

  // Kept live via a ref (rather than closing over `value` directly) so the
  // onText callback passed to useDictation stays a stable identity across
  // renders -- see the handoff for why that matters here.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // The composer text as it was the moment THIS dictation utterance began.
  // Every onText call (interim or final) replaces the portion appended
  // after this snapshot with the latest transcript, instead of appending
  // on every call -- the Web Speech API convention is that each interim
  // update repeats the whole utterance-so-far, not just a delta, so
  // blindly appending would duplicate words on every update. Reset to null
  // on isFinal so the *next* utterance snapshots fresh, already-committed
  // text as its own new base.
  const dictationBaseRef = useRef<string | null>(null);

  const handleDictationText = useCallback(
    (text: string, isFinal: boolean) => {
      if (dictationBaseRef.current === null) {
        dictationBaseRef.current = valueRef.current;
      }
      const base = dictationBaseRef.current;
      const needsSpace = base.length > 0 && !/\s$/.test(base) && text.length > 0;
      onChange(base + (needsSpace ? " " : "") + text);
      if (isFinal) {
        dictationBaseRef.current = null;
      }
    },
    [onChange],
  );

  const dictation = useDictation({ onText: handleDictationText, active: micOn });

  // If dictation becomes unavailable or errors out, don't leave the mic
  // looking "on" with nothing happening.
  useEffect(() => {
    if (micOn && (dictation.status === "unavailable" || dictation.status === "error")) {
      setMicOn(false);
    }
  }, [micOn, dictation.status]);

  function toggleMic() {
    setMicOn((prev) => !prev);
  }

  function submit() {
    if (sending || !value.trim()) return;
    onSend();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const micLabel = micOn ? "Stop dictation" : "Start dictation";

  return (
    <form
      className="assistant-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="assistant-composer-row">
        <textarea
          className="assistant-composer-input"
          aria-label="Message"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Type a message…"}
          rows={2}
          disabled={sending}
        />
        <div className="assistant-composer-actions">
          <button
            type="button"
            className={`assistant-mic-btn${micOn ? " is-active" : ""}`}
            onClick={toggleMic}
            aria-pressed={micOn}
            aria-label={micLabel}
            title={dictation.status === "unavailable" ? "Dictation unavailable in this browser" : micLabel}
            disabled={dictation.status === "unavailable"}
          >
            <Icon name="mic" size={18} />
          </button>
          {sending ? (
            <button type="button" className="assistant-send-btn assistant-stop-btn" aria-label="Stop" onClick={onCancel}>
              Stop
            </button>
          ) : (
            <button type="submit" className="assistant-send-btn" aria-label="Send message" disabled={!value.trim()}>
              <Icon name="send" size={18} />
            </button>
          )}
        </div>
      </div>
      {dictation.status === "error" && (
        <p className="assistant-composer-note assistant-composer-note--error" role="alert">
          Dictation error -- you can still type your message.
        </p>
      )}
    </form>
  );
}
