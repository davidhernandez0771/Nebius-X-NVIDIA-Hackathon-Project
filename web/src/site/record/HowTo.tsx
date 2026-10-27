// "How to use it" on /record (2026-10-27, the tutorial): four short steps for a first-timer, in the camera pane's top
// left under the input switch the first step names. Open on a first visit; Hide (or the "? How to" toggle in the pane's
// header) folds it away, and the browser remembers which (localStorage, which may refuse: then it is open each visit).
import { useId, useState } from "react";

export const HOWTO_KEY = "sant.record.howto";

function read(): string | null {
  try {
    return window.localStorage.getItem(HOWTO_KEY);
  } catch {
    return null;
  }
}

function write(open: boolean): void {
  try {
    window.localStorage.setItem(HOWTO_KEY, open ? "open" : "closed");
  } catch {
    /* blocked storage: it just isn't remembered */
  }
}

export const HOWTO_STEPS: readonly { lead: string; rest: string }[] = [
  { lead: "Pick an input:", rest: "Keyboard, Mouse or Camera." },
  { lead: "Press Start,", rest: "then Record." },
  { lead: "Drive to the cube,", rest: "grab it, and drop it in the bin." },
  { lead: "Stop:", rest: "press Record again. SANT checks it in physics." },
];

/** The toggle (for the pane's header) and the box; one state, so both are one component with two parts. */
export function useHowTo() {
  const [open, setOpen] = useState(() => read() !== "closed");
  const id = useId();
  const set = (next: boolean) => {
    setOpen(next);
    write(next);
  };
  const toggle = (
    <button type="button" className="rg-btn rg-btn--small rg-howto__toggle" aria-expanded={open} aria-controls={id} onClick={() => set(!open)}>
      <span aria-hidden="true">? </span>How to
    </button>
  );
  const box = (
    <section id={id} className="rg-howto" aria-label="How to use it" hidden={!open}>
      <div className="rg-howto__hd">
        <h2 className="rg-howto__title">How to use it</h2>
        <button type="button" className="rg-btn rg-btn--small" onClick={() => set(false)}>
          Hide
        </button>
      </div>
      <ol className="rg-howto__steps">
        {HOWTO_STEPS.map((s) => (
          <li key={s.lead}>
            <b>{s.lead}</b> {s.rest}
          </li>
        ))}
      </ol>
    </section>
  );
  return { open, toggle, box };
}
