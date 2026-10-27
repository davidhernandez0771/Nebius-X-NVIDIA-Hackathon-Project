// The loader's mark in characters (asciiMark.ts): the open-corner tesseract as a grid of digits that writes itself
// in as the real load goes (the parts in the logo's own order, a scrambling head just behind the progress), on a 2D
// canvas, so it costs nothing next to the work it waits for. The unwritten mark shows as faint dots from the start.
// With reduced motion nothing scrambles: the cells simply light as the load goes. Decorative: the loader's progress
// bar carries the value, so the canvas is one image named for the brand.
import { useEffect, useMemo, useRef } from "react";
import { asciiMark, cellState } from "./asciiMark";

const INK = [216, 239, 233];
const TEAL = [25, 245, 194];
/** How often the writing head scrambles (ms). */
const SCRAMBLE_MS = 70;

export function DigitMark({ value, reduced }: { value: number; reduced: boolean }) {
  const mark = useMemo(() => asciiMark(), []);
  const canvas = useRef<HTMLCanvasElement>(null);
  const progress = useRef(value);
  progress.current = value;

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let raf = 0;
    let last = -Infinity;
    let drawn = -1;
    const draw = (now: number) => {
      const w = el.clientWidth || 260;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = w / mark.cols;
      const ch = cw * mark.cellAspect;
      const h = ch * mark.rows;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
        el.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = `500 ${(cw * 1.55).toFixed(2)}px "Geist Mono", ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const p = progress.current;
      const tick = Math.floor(now / SCRAMBLE_MS);
      for (const c of mark.cells) {
        const s = cellState(c, p);
        const x = (c.col + 0.5) * cw, y = (c.row + 0.5) * ch;
        const [r, g, b] = c.accent ? TEAL : INK;
        if (s === "dark") {
          ctx.fillStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},${(0.05 + 0.07 * c.weight).toFixed(3)})`;
          ctx.fillText("·", x, y);
        } else if (s === "head" && !reduced) {
          // Being written: a fresh digit every few frames, bright.
          ctx.fillStyle = `rgba(${TEAL[0]},${TEAL[1]},${TEAL[2]},0.95)`;
          ctx.fillText(String((c.col * 7 + c.row * 13 + tick) % 10), x, y);
        } else {
          ctx.fillStyle = `rgba(${r},${g},${b},${(0.3 + 0.65 * c.weight).toFixed(3)})`;
          ctx.fillText(c.glyph, x, y);
        }
      }
      drawn = p;
    };
    const loop = (now: number) => {
      // About 30 frames a second while the head writes; only on a change once it has stopped.
      if ((!reduced && progress.current < 1 && now - last > 33) || progress.current !== drawn) {
        last = now;
        draw(now);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mark, reduced]);

  return <canvas ref={canvas} className="world-loader__ascii" role="img" aria-label="SANT" />;
}
