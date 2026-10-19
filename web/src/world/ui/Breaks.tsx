// The breaks (ui/wipe.ts): dark slabs with a slanted, torn top edge that move up with the scroll and
// uncover one section each, a big headline left and a few lines right, over the 3D, which keeps
// running behind them, darkened. They follow the station's frame (the store's damped scroll) through
// useStationFrame: per frame only two transforms per moving band are written, and only when they
// change; each band's clip-path is set once. With reduced motion the sections swap whole, at once.
import { useMemo, useRef, type ReactNode } from "react";
import { useStationFrame, useWorld } from "../core/WorldContext";
import type { StationId } from "../core/types";
import { scramble } from "./scramble";
import { band, bandClip, BAND_VH, edgeLine, LINE_VH, MARGIN, PLAN, SPAN } from "./wipe";
import "./wipe.css";

export interface BreakSection {
  /** The small line over the headline ("01 · The problem"). */
  label: string;
  /** The left column: the headline. Mark text to reveal with the scramble with `data-scramble`. */
  head: ReactNode;
  /** The right column: two or three short lines. */
  side: ReactNode;
  className?: string;
}

interface Shown {
  y: number;
  visible: boolean;
  on: boolean;
}

/** How far (vh) an edge's line sits inside the band it belongs to, so the band's clip doesn't halve it. */
const LINE_INSET = 0.3;

/**
 * The sections, PLAN.sections of them, over `length` vh of the station's dwell (the station's
 * `length`), so scroll s (vh) = frame.t × length.
 */
export function Breaks({ station, length, sections }: { station: StationId; length: number; sections: BreakSection[] }) {
  const { store, reduced } = useWorld();
  const bands = useRef<(HTMLDivElement | null)[]>([]);
  const inner = useRef<(HTMLDivElement | null)[]>([]);
  const shown = useRef<Shown[]>([]);
  const clips = useMemo(() => sections.map((_, k) => bandClip(k)), [sections]);
  if (import.meta.env.DEV && sections.length !== PLAN.sections) console.warn(`world: Breaks has ${sections.length} sections, the plan ${PLAN.sections}`);

  useStationFrame(station, (f) => {
    const { ready, branch } = store.getCoarse();
    const live = ready && !branch && f.arrive >= 1;
    const s = f.t * length;
    sections.forEach((_, k) => {
      const el = bands.current[k];
      const box = inner.current[k];
      if (!el || !box) return;
      const b = band(s, k, reduced);
      const visible = live && b.visible;
      const on = visible && b.on;
      const prev = (shown.current[k] ??= { y: NaN, visible: false, on: false });
      if (visible !== prev.visible) {
        prev.visible = visible;
        el.dataset.live = String(visible);
      }
      if (visible && b.y !== prev.y) {
        prev.y = b.y;
        el.style.transform = `translate3d(0, ${b.y}vh, 0)`;
        box.style.transform = `translate3d(0, ${-b.y}vh, 0)`;
      }
      if (on !== prev.on) {
        prev.on = on;
        el.dataset.on = String(on);
        el.querySelectorAll<HTMLElement>("[data-scramble]").forEach((t) => {
          const final = (t.dataset.final ??= t.textContent ?? "");
          if (on) window.setTimeout(() => shown.current[k]?.on && scramble(t, final, { reduced }), reduced ? 0 : 120);
          else t.textContent = final;
        });
      }
    });
  });

  const last = sections.length - 1;
  return (
    <div className="world-breaks">
      {sections.map((sec, k) => (
        <div
          key={k}
          ref={(el) => (bands.current[k] = el)}
          className={`world-break ${sec.className ?? ""}`}
          data-on="false"
          data-live="false"
          style={{ height: `${BAND_VH}vh`, clipPath: clips[k], transform: "translate3d(0, 110vh, 0)" }}
        >
          <EdgeLine k={k} top={-MARGIN} inset={LINE_INSET} />
          {k === last ? <EdgeLine k={k + 1} top={SPAN - MARGIN} inset={-LINE_INSET} /> : null}
          <div ref={(el) => (inner.current[k] = el)} className="world-break__box">
            <div className="world-break__grid">
              <div className="world-break__head">
                <p className="world-break__label world-u">{sec.label}</p>
                {sec.head}
              </div>
              <div className="world-break__side">{sec.side}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Edge k's hairline, `top` vh into the band's box. */
function EdgeLine({ k, top, inset }: { k: number; top: number; inset: number }) {
  const points = useMemo(() => edgeLine(k, inset), [k, inset]);
  return (
    <svg className="world-break__edge" style={{ top: `${top}vh`, height: `${LINE_VH}vh` }} viewBox={`0 0 100 ${LINE_VH}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}
