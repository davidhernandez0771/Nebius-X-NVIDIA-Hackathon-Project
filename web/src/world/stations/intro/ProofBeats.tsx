// The story's proof beats (intro-proof, 2026-10-26, the user): the Results page's proof, told in the journey itself,
// so a judge who only scrolls still sees it. After the reactor's beats and before the ring (storyPlan.ts, the proof
// stage) the core holds at full power while four beats take the screen in turn, each on a dim glass panel:
//   05 How SANT works: the pipeline in five steps, lit one by one;
//   06 The proof: the climb 0/40 → 3/40 → 15/40 → 30/40 against the 60% goal, with Wilson intervals;
//   07 Did the human demos matter?: the teacher's curve with and without human demo starts, drawing itself;
//   08 SANT checks the teacher too: the speed gate, 3/50 uncapped, then 50/50 capped.
// The figures are shared with the workshop's proof wall (ui/proofFigures.tsx). Here each graph is drawn by the scroll
// (proofBeatState's `draw`), never by a timer, so scrolling back undraws it; with reduced motion it is whole as soon
// as its beat shows. Each beat is a named region you can Tab to (focusing it brings the story there).
// The per-frame work is a few style writes when the draw changes.
import { useId, useLayoutEffect, useRef } from "react";
import { useStationFrame, useWorld } from "../../core/WorldContext";
import { scrollToY } from "../../core/scroll";
import { PROOF_FIGURES, type Paint } from "../../ui/proofFigures";
import { INTRO_VH, PROOF_BEATS, proofBeatSpan, proofBeatState } from "./storyPlan";

export { sourcesLine } from "../../ui/proofFigures";

/** Where a focused beat is brought to: in its hold, whole and fully shown. */
const HOLD_AT = 0.72;

/** The story numbers the beats on from the reactor's four: 05 to 08. */
const BEATS = PROOF_FIGURES.map((f, i) => ({ ...f, kicker: `${String(5 + i).padStart(2, "0")} / ${f.name}` }));

if (BEATS.length !== PROOF_BEATS) throw new Error("ProofBeats: one beat per proof span (storyPlan.ts PROOF_BEATS)");

export function ProofBeats() {
  const { store, reduced } = useWorld();
  const id = useId();
  const roots = useRef<(HTMLElement | null)[]>([]);
  const painters = useRef<(Paint | null)[]>([]);
  const last = useRef<{ shown: number; draw: number }[]>([]);
  // Stable per beat, so the figures register once.
  const registers = useRef(BEATS.map((_, i) => (p: Paint) => (painters.current[i] = p)));

  useLayoutEffect(() => {
    // A change of motion (reduced on or off) repaints everything.
    last.current = [];
  }, [reduced]);

  useStationFrame("intro", (f) => {
    const ready = store.getCoarse().ready;
    const vh = f.t * INTRO_VH;
    BEATS.forEach((_, i) => {
      const el = roots.current[i];
      if (!el) return;
      const s = proofBeatState(vh, i);
      const shown = ready ? s.shown : 0;
      const draw = reduced ? 1 : s.draw;
      const prev = last.current[i];
      if (prev && prev.shown === shown && prev.draw === draw) return;
      last.current[i] = { shown, draw };
      el.style.opacity = String(shown);
      el.dataset.shown = String(shown > 0.5);
      el.style.transform = reduced ? "" : `translate3d(0, ${((1 - shown) * 1.6).toFixed(3)}vh, 0)`;
      if (!prev || prev.draw !== draw) painters.current[i]?.(draw);
    });
  });

  /** Tab (or a screen reader's focus) on a beat brings the story to it, so what has the focus is on screen. */
  const bringIn = (i: number) => {
    const vh = store.frames.intro.t * INTRO_VH;
    if (store.getCoarse().current !== "intro" || proofBeatState(vh, i).shown > 0.99) return;
    const [a, b] = proofBeatSpan(i);
    const span = store.rail.spans[0];
    const y = span.start + ((span.end - span.start) * (a + (b - a) * HOLD_AT)) / INTRO_VH;
    store.jump(y);
    scrollToY(y, false);
  };

  return (
    <div className="intro-pbeats">
      {BEATS.map((b, i) => (
        <section
          key={b.key}
          ref={(el) => (roots.current[i] = el)}
          className="intro-pbeat"
          data-beat={b.key}
          data-shown="false"
          aria-labelledby={`${id}-${i}-k ${id}-${i}-h`}
          tabIndex={0}
          onFocus={() => bringIn(i)}
          style={{ opacity: 0 }}
        >
          <div className="intro-pbeat__panel">
            <header className="intro-pbeat__head-block">
              <p id={`${id}-${i}-k`} className="intro-pbeat__kicker world-u">
                {b.kicker}
              </p>
              <h2 id={`${id}-${i}-h`} className="intro-pbeat__head">
                {b.head.map((line, j) => [
                  j > 0 ? " " : null,
                  <span key={j} className="intro-pbeat__line">
                    {line}
                  </span>,
                ])}
              </h2>
            </header>
            <b.Graph register={registers.current[i]} links />
          </div>
        </section>
      ))}
    </div>
  );
}
