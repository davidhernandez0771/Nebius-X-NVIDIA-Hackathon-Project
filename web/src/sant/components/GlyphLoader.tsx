import { useEffect, useState } from "react";
import { GLYPHS, resolveGlyphs } from "../motion/glyphs";
import { useMotion } from "../motion/MotionProvider";

const BAND = 28;
const TICK_MS = 60;

/**
 * The loader for slow starts (Isaac Sim, MediaPipe): the label resolves out of loader glyphs from
 * the left, over a band of slashes that fills with the progress. With `progress` it is a progress
 * bar; without, a status message whose label resolves, holds, and scrambles again. Reduced motion
 * shows the plain label and a still band.
 */
export function GlyphLoader({ label, progress, done = false, detail }: { label: string; progress?: number; done?: boolean; detail?: string }) {
  const { reduced } = useMotion();
  const [tick, setTick] = useState(0);
  const still = reduced || done;

  useEffect(() => {
    if (still) return;
    const id = window.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [still]);

  const p = done ? 1 : progress === undefined ? undefined : Math.min(1, Math.max(0, progress));
  // Indeterminate: resolve over the label's length, hold for 12 ticks, then start again.
  const resolved = still ? label.length : p === undefined ? tick % (label.length + 12) : Math.round(p * label.length);
  const text = resolveGlyphs(label, resolved, tick);
  const filled = p === undefined ? (still ? 0 : tick % (BAND + 1)) : Math.round(p * BAND);
  const band = Array.from({ length: BAND }, (_, i) => (i < filled ? "/" : still ? "·" : GLYPHS[(i + tick) % GLYPHS.length]));
  const role = p === undefined ? { role: "status" as const } : { role: "progressbar" as const, "aria-valuenow": Math.round(p * 100), "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": label };

  return (
    <div className="sant-glyphs" data-done={done} data-animate={!reduced} {...role}>
      <span className="sant-sr-only">{p === undefined ? label : null}</span>
      <span className="sant-glyphs__text" aria-hidden="true">
        {text}
      </span>
      <span className="sant-glyphs__band" aria-hidden="true">
        {band.map((g, i) => (
          <span key={i} data-on={i < filled}>
            {g}
          </span>
        ))}
        {p !== undefined && <span className="sant-glyphs__pct">{String(Math.round(p * 100)).padStart(3, "0")}</span>}
      </span>
      {detail && <span className="sant-glyphs__detail">{detail}</span>}
    </div>
  );
}
