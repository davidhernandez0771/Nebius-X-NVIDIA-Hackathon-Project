// Inside the proof wall (proof-wall, 2026-10-26, the user): the story's four proof figures (ui/proofFigures.tsx, the
// very same components and numbers as the intro's beats) as four panels on the wall's screen, stepped through with
// Previous and Next, the arrow keys or the dots. On a landscape screen the panel is laid exactly over the wall's
// screen (view.ts SCREEN_IN_VH), which goes blank behind it (scene/ProofWall.tsx), so the figures read as the
// board's own content; upright, and without the 3D, it is a solid panel. Each graph draws in when its panel opens (a
// short timed play on requestAnimationFrame, the same draw 0 → 1 the story's scroll gives it; on entering, after the
// camera has turned to the wall); with reduced motion it is whole at once.
// After the panels, the story's two ways on: the real test runs and every number with its sources. The way out is
// the workshop's own (ui/StationBar): Back to room, Escape, the browser's Back (core/placeHash.ts).
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useWorld } from "../../core/WorldContext";
import { StationBar } from "../../ui/StationBar";
import { PROOF_FIGURES, ProofLinks, type Paint } from "../../ui/proofFigures";
import { SCREEN_IN_VH } from "./view";
import "./proof.css";

/** How long a panel's graph takes to draw in (ms). */
export const PLAY_MS = 1800;
/** On entering, the first graph waits for the camera to turn to the wall and the panel to come in (ms; proof.css). */
export const ENTER_MS = 800;

/** The panel's box: the screen, from the camera (view.ts). */
const SCREEN = { "--proof-w": `${(100 * SCREEN_IN_VH.w).toFixed(2)}vh`, "--proof-h": `${(100 * SCREEN_IN_VH.h).toFixed(2)}vh` } as CSSProperties;

const N = PROOF_FIGURES.length;

/** Keys typed into a field are the field's. */
function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export function Place({ current, reduced }: { current: boolean; reduced: boolean }) {
  const { back } = useWorld();
  const id = useId();
  const [at, setAt] = useState(0);
  const painters = useRef<(Paint | null)[]>([]);
  // Stable per panel, so the figures register once.
  const registers = useRef(PROOF_FIGURES.map((_, i) => (p: Paint) => (painters.current[i] = p)));

  // Each visit starts at the first panel; its graph waits for the way in.
  const entering = useRef(false);
  useLayoutEffect(() => {
    if (current) entering.current = true;
    else setAt(0);
  }, [current]);

  // The open panel's graph draws in; with reduced motion it is whole at once.
  useLayoutEffect(() => {
    if (!current) return;
    const paint = painters.current[at];
    if (!paint) return;
    if (reduced) {
      paint(1);
      return;
    }
    paint(0);
    const delay = entering.current ? ENTER_MS : 0;
    entering.current = false;
    let live = true;
    let start = -1;
    let frame = 0;
    const step = (now: number) => {
      if (!live) return;
      if (start < 0) start = now + delay;
      const draw = Math.min(1, Math.max(0, (now - start) / PLAY_MS));
      paint(draw);
      if (draw < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
    };
  }, [current, at, reduced]);

  // The arrow keys step, while the place is open.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
      if (e.key === "ArrowRight") setAt((a) => Math.min(N - 1, a + 1));
      else if (e.key === "ArrowLeft") setAt((a) => Math.max(0, a - 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  const name = (i: number) => `Panel ${i + 1} of ${N}: ${PROOF_FIGURES[i].name}`;

  return (
    <>
      <StationBar on={current} title="The proof" hint="← → or the dots step through the four" back={() => back()} />
      <section className="world-proof" aria-label="The proof wall" aria-hidden={!current} data-on={current} data-at={PROOF_FIGURES[at].key} style={SCREEN}>
        <div className="world-proof__screen intro-pbeat__panel">
          {PROOF_FIGURES.map((f, i) => (
            <section key={f.key} className="world-proof__panel" data-panel={f.key} hidden={i !== at} aria-labelledby={`${id}-${i}-k ${id}-${i}-h`}>
              <header className="intro-pbeat__head-block">
                <p id={`${id}-${i}-k`} className="intro-pbeat__kicker world-u">
                  {`${i + 1} / ${N} · ${f.name}`}
                </p>
                <h2 id={`${id}-${i}-h`} className="intro-pbeat__head world-proof__head">
                  {f.head.map((line, j) => [
                    j > 0 ? " " : null,
                    <span key={j} className="intro-pbeat__line">
                      {line}
                    </span>,
                  ])}
                </h2>
              </header>
              <f.Graph register={registers.current[i]} />
            </section>
          ))}
          <footer className="world-proof__foot">
            <nav className="world-proof__nav world-u" aria-label="The proof's panels">
              <button type="button" className="world-proof__btn" aria-label="Previous panel" disabled={at === 0} onClick={() => setAt((a) => Math.max(0, a - 1))}>
                <span aria-hidden="true">←</span> Prev
              </button>
              <ol className="world-proof__dots">
                {PROOF_FIGURES.map((f, i) => (
                  <li key={f.key}>
                    <button type="button" className="world-proof__dot" aria-label={name(i)} aria-current={i === at ? "step" : undefined} onClick={() => setAt(i)}>
                      <i aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
              <span className="world-proof__count" aria-hidden="true">
                {at + 1} / {N}
              </span>
              <button type="button" className="world-proof__btn" aria-label="Next panel" disabled={at === N - 1} onClick={() => setAt((a) => Math.min(N - 1, a + 1))}>
                Next <span aria-hidden="true">→</span>
              </button>
            </nav>
            <ProofLinks className="intro-pbeat__links world-proof__links" />
          </footer>
          <p className="world-sr" aria-live="polite">
            {current ? name(at) : ""}
          </p>
        </div>
      </section>
    </>
  );
}
