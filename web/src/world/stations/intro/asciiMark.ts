// The loader's mark drawn in characters: the open-corner tesseract (sant/components/logoSymbol.ts, its own paths)
// laid on a grid of monospace cells. Each cell on a stroke holds a digit (a dot or two at the strokes' soft edges),
// knows which part of the mark it belongs to, and where along that part it lies, so the mark fills in in the logo's
// own lighting order (the frame, the corner lines, the cube, its near corner) as the real load goes from 0 to 100%
// (progress.ts). DigitMark.tsx draws it. Pure and seed-free, so the tests hold it; decorative only (the loader's
// progress bar carries the meaning), so the characters never carry text.
import { LOGO_SYMBOL } from "../../../sant/components/logoSymbol";

/** A stroke: from (ax, ay) to (bx, by), in the symbol's viewBox units. */
export type Segment = [number, number, number, number];

/** The strokes of one part's path data (M, L and Z only, as the symbol is drawn). */
export function parsePath(d: string): Segment[] {
  const out: Segment[] = [];
  const re = /([MLZ])\s*(-?[\d.]+)?\s*,?\s*(-?[\d.]+)?/gi;
  let start: [number, number] | null = null;
  let at: [number, number] | null = null;
  for (let m = re.exec(d); m; m = re.exec(d)) {
    const op = m[1].toUpperCase();
    if (op === "Z") {
      if (at && start) out.push([at[0], at[1], start[0], start[1]]);
      at = start;
      continue;
    }
    const p: [number, number] = [Number(m[2]), Number(m[3])];
    if (op === "M") start = p;
    else if (at) out.push([at[0], at[1], p[0], p[1]]);
    at = p;
  }
  return out;
}

export interface AsciiCell {
  col: number;
  row: number;
  /** The part of the mark (LOGO_SYMBOL.units' index, its lighting order). */
  unit: number;
  /** 0–1: when it lights, over the whole load (the parts in turn, each along its strokes). */
  order: number;
  /** 0–1: how near the stroke's middle (1 on it). */
  weight: number;
  /** Drawn in the accent (the inner cube). */
  accent: boolean;
  /** Its character once written. */
  glyph: string;
}

export interface AsciiMark {
  cols: number;
  rows: number;
  /** A cell's height over its width (a monospace character's box). */
  cellAspect: number;
  cells: AsciiCell[];
}

/** The writing head: cells lit in the last this share of the load still scramble. */
export const HEAD = 0.035;

const DIGITS = "0123456789";
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** The mark on a grid `cols` cells wide, each cell `cellAspect` times as tall as it is wide. */
export function asciiMark(cols = 46, cellAspect = 1.8): AsciiMark {
  const [minX, minY, w, h] = LOGO_SYMBOL.viewBox.split(/\s+/).map(Number);
  const cw = w / cols;
  const ch = cw * cellAspect;
  const rows = Math.ceil(h / ch);
  const parts = LOGO_SYMBOL.units.map(parsePath);
  const lengths = parts.map((p) => p.reduce((s, [ax, ay, bx, by]) => s + Math.hypot(bx - ax, by - ay), 0));
  const reach = LOGO_SYMBOL.stroke / 2 + cw * 0.3;
  const cells: AsciiCell[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const x = minX + (col + 0.5) * cw;
      const y = minY + (row + 0.5) * ch;
      // The nearest stroke of any part, and how far along its part that point lies.
      let best = Infinity, unit = -1, along = 0;
      parts.forEach((segs, u) => {
        let run = 0;
        for (const [ax, ay, bx, by] of segs) {
          const dx = bx - ax, dy = by - ay;
          const len = Math.hypot(dx, dy);
          const t = len ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (len * len))) : 0;
          const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
          if (d < best) {
            best = d;
            unit = u;
            along = (run + t * len) / lengths[u];
          }
          run += len;
        }
      });
      if (best >= reach) continue;
      const weight = 1 - best / reach;
      const r = hash(col, row);
      const glyph = weight > 0.28 ? DIGITS[Math.floor(r * 10)] : r < 0.5 ? "." : ":";
      cells.push({ col, row, unit, order: (unit + along * 0.999) / parts.length, weight, accent: LOGO_SYMBOL.accent.includes(unit), glyph });
    }
  return { cols, rows, cellAspect, cells };
}

/** A cell at load progress p: still dark, being written (the head, scrambling), or lit. */
export function cellState(c: AsciiCell, p: number): "dark" | "head" | "lit" {
  if (p <= 0 || c.order > p) return "dark";
  return p < 1 && c.order > p - HEAD ? "head" : "lit";
}
