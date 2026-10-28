// Ask SANT: the pill under the filters, and the last three lines of the conversation above it (the
// tool call in teal, then the reply). Focusing it slides in where the question goes.
import { useState, type FormEvent } from "react";
import { useAsk } from "./useAsk";

export function AskBox() {
  const { log, busy, ask } = useAsk();
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text;
    setText("");
    void ask(q);
  };
  return (
    <div className="world-ask">
      <div className="world-ask__log" aria-live="polite">
        {log.map((l) => (
          <div key={l.id} className={`world-ask__line world-ask__line--${l.kind}`}>
            {l.text}
          </div>
        ))}
        {busy ? <div className="world-ask__line world-ask__line--note">…</div> : null}
      </div>
      <p className="world-ask__privacy world-u">Your question goes to Nemotron through the SANT backend.</p>
      <form className="world-ask__pill" onSubmit={submit} autoComplete="off">
        <input className="world-u" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask SANT anything..." aria-label="Ask SANT" maxLength={500} />
        <span className="world-ask__k" aria-hidden="true">
          ↵
        </span>
      </form>
    </div>
  );
}
