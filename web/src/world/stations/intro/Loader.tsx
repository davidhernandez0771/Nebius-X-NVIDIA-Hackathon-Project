// The loader: a real one. It holds the page (no scroll) until the first scene is truly ready
// (progress.ts: the 3D engine, the type, the tesseract built, every shader compiled, a few steady frames),
// and shows that work as it happens: the SANT mark lighting part by part, a bar, the share and what it is
// waiting for now. Then it lets go into the hero (the mark lifts and fades as the black opens; with reduced
// motion a plain fade). The heavier stations keep streaming in the background (core/assets.ts).
// It never traps anyone: after CONTINUE_MS it offers "Continue anyway" (in at what is ready) and the 2D
// version; if the 3D engine never even started by STALL_MS it falls back to the stills by itself.
import { useEffect, useRef, useState } from "react";
import { Logo } from "../../../sant/components/Logo";
import { useWorld } from "../../core/WorldContext";
import { LOGO_SYMBOL } from "../../../sant/components/logoSymbol";
import { load, type Status } from "./progress";

/** Hold at 100 for a breath before lifting, so the full bar registers. */
const HOLD_MS = 350;
/** The lift's length (intro.css .world-loader[data-done]). */
const LIFT_MS = 900;
/** After this long, the way on: continue anyway, or the 2D version. */
export const CONTINUE_MS = 12000;
/** If the 3D engine hasn't even started by now, fall back to the stills. */
export const STALL_MS = 30000;
/** The faces the hero's words, the beats and the mark's wordmark are set in, each counted as it loads. */
const FONTS = ['400 16px "Geist Mono"', '500 12px "Geist Mono"', '600 16px "Geist"'];
/** A face that takes longer than this counts anyway (a blocked font server must not hold the page). */
const FONT_CAP_MS = 4000;

export function Loader() {
  const { store, reduced, mode, fail } = useWorld();
  const [gone, setGone] = useState(mode !== "3d" || store.getCoarse().ready);
  const [done, setDone] = useState(gone);
  const [status, setStatus] = useState<Status>(() => load.status());
  const [value, setValue] = useState(() => load.value());
  const [slow, setSlow] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Hold the page still while loading: nobody scrolls into a scene that isn't there yet.
  useEffect(() => {
    if (done) return;
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = before;
    };
  }, [done]);

  useEffect(() => {
    if (gone) return;
    // The type: each face counts as it arrives (or after FONT_CAP_MS, so a blocked font server can't hold it).
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    let faces = 0;
    load.count("fonts", 0, FONTS.length);
    for (const f of FONTS) {
      const cap = new Promise((r) => setTimeout(r, FONT_CAP_MS));
      Promise.race([fonts ? fonts.load(f) : Promise.resolve(), cap])
        .catch(() => undefined)
        .then(() => load.count("fonts", ++faces, FONTS.length));
    }

    let hold: ReturnType<typeof setTimeout> | undefined;
    let lift: ReturnType<typeof setTimeout> | undefined;
    const paint = () => {
      setValue(load.value());
      setStatus(load.status());
      if (load.done() && !hold) {
        hold = setTimeout(
          () => {
            store.setReady();
            setDone(true);
            lift = setTimeout(() => setGone(true), reduced ? 0 : LIFT_MS);
          },
          reduced ? 0 : HOLD_MS,
        );
      }
    };
    paint();
    const off = load.subscribe(paint);
    const offer = setTimeout(() => setSlow(true), CONTINUE_MS);
    const stall = setTimeout(() => {
      // The engine never even started (no chunk, no context): the stills, rather than a page that never comes.
      if (!load.done() && load.status().step === "engine") fail();
    }, STALL_MS);
    return () => {
      off();
      clearTimeout(offer);
      clearTimeout(stall);
      if (hold) clearTimeout(hold);
      if (lift) clearTimeout(lift);
    };
  }, [gone, store, reduced, fail]);

  if (gone) return null;
  const pct = Math.round(value * 100);
  // The mark's parts light in their order as the work gets done; the last one at the end.
  const lit = Math.min(LOGO_SYMBOL.units.length, Math.floor(value * LOGO_SYMBOL.units.length + 1e-9));
  const text = status.step ? (status.detail ? `${status.label}, ${status.detail}` : status.label) : "Ready";
  return (
    <div ref={root} className="world-loader" data-done={done} data-slow={slow && !done}>
      <div className="world-loader__mark" data-lit={done ? LOGO_SYMBOL.units.length : lit}>
        <Logo size="lg" lit="all" />
      </div>
      <div
        className="world-loader__bar"
        role="progressbar"
        aria-label="Loading SANT"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={text}
      >
        <i style={{ transform: `scaleX(${value})` }} />
      </div>
      <p className="world-loader__status" aria-hidden="true">
        <span className="world-loader__pct">{pct}%</span>
        <span className="world-loader__label">{status.label}</span>
        {status.detail ? <span className="world-loader__detail">{status.detail}</span> : null}
      </p>
      {slow && !done ? (
        <div className="world-loader__slow" role="group" aria-label="Taking a while">
          <p>This device is taking a while to start the 3D.</p>
          <div>
            <button type="button" onClick={() => load.release()}>
              Continue anyway
            </button>
            <button type="button" onClick={fail}>
              Use the 2D version
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
