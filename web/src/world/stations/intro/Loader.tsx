// The loader: a cartridge drawn in slashes fills from the bottom with the real progress (progress.ts),
// with a //N counter under it. At 100 it lets go: the store is ready, the workshop starts streaming,
// and the logo gathers. If the 3D never gets there (no context, a stalled chunk) the world falls back
// to the stills rather than hanging on the loader.
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorld } from "../../core/WorldContext";
import { cartridgeRows, litRows, load } from "./progress";

/** Hold at 100 for a breath before fading, so the full cartridge registers. */
const HOLD_MS = 450;
/** Give up on the 3D after this long. */
export const STALL_MS = 20000;

export function Loader() {
  const { store, reduced, mode, fail } = useWorld();
  const rows = useMemo(() => cartridgeRows(), []);
  const rowEls = useRef<(HTMLSpanElement | null)[]>([]);
  const count = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(mode !== "3d" || store.getCoarse().ready);
  const [done, setDone] = useState(gone);

  useEffect(() => {
    if (gone) return;
    load.reset();
    // Fonts first: the loader's own counter, the beats and the cartridge labels are Geist Mono.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const cap = new Promise((r) => setTimeout(r, 3000));
    Promise.race([fonts ? Promise.all([fonts.load('300 40px "Geist Mono"'), fonts.load('500 12px "Geist Mono"')]) : Promise.resolve(), cap])
      .catch(() => {})
      .then(() => load.set("fonts", 1));

    let hold: ReturnType<typeof setTimeout> | undefined;
    const paint = (v: number) => {
      const lit = litRows(v, rows.length);
      // Bottom row first.
      rowEls.current.forEach((el, i) => el?.classList.toggle("is-lit", rows.length - 1 - i < lit));
      if (count.current) count.current.textContent = `//${Math.round(v * 100)}`;
      root.current?.setAttribute("aria-valuenow", String(Math.round(v * 100)));
      if (v >= 1 && !hold) {
        hold = setTimeout(() => {
          store.setReady();
          setDone(true);
          setTimeout(() => setGone(true), reduced ? 0 : 800);
        }, reduced ? 0 : HOLD_MS);
      }
    };
    paint(load.value());
    const off = load.subscribe(paint);
    const stall = setTimeout(() => {
      if (load.value() < 1) fail();
    }, STALL_MS);
    return () => {
      off();
      clearTimeout(stall);
      if (hold) clearTimeout(hold);
    };
  }, [gone, rows, store, reduced, fail]);

  if (gone) return null;
  return (
    <div ref={root} className="world-loader" data-done={done} role="progressbar" aria-label="Loading the workshop" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
      <pre className="world-loader__cart" aria-hidden="true">
        {rows.map((r, i) => (
          <span key={i} ref={(el) => (rowEls.current[i] = el)}>
            {r}
            {"\n"}
          </span>
        ))}
      </pre>
      <div ref={count} className="world-loader__count">
        //0
      </div>
    </div>
  );
}
