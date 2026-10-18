// "A demo becomes data": a replay frame turns, column by column, into a matrix of square ink dots
// sized by how dark each cell is. The seam between photo and data is ragged, wanders a little, and
// follows the scroll. Pure, so DotMatrix.tsx only draws it.

export type Cell = { size: number; accent: boolean };

/** The smallest dot, as a share of the cell: white floor still shows as a faint grid. */
export const MIN_DOT = 0.1;
/** How many columns the mixed photo/data band spans. */
const BAND = 5;
/** How far, in columns, a row's seam can wander from the others. */
const RAGGED = 2.5;

function hash(c: number, r: number, k = 0): number {
  const s = Math.sin(c * 127.1 + r * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** One cell per pixel of an RGBA buffer `cols` × `rows` (the frame drawn down to the grid). */
export function cellsFromPixels(data: ArrayLike<number>, cols: number, rows: number): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const dark = 1 - (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    cells.push({
      size: Math.max(MIN_DOT, Math.min(1, 1.1 * dark ** 0.8)),
      // The red cube is the one thing the demo is about; it keeps the accent on the data side.
      accent: r > 140 && r - g > 80 && r - b > 80,
    });
  }
  return cells;
}

/** Where row `row`'s seam sits, in columns: past the right edge at progress 0, past the left at 1. */
export function seamColumn(row: number, progress: number, t: number, cols: number): number {
  const from = cols + BAND / 2 + RAGGED;
  const to = -BAND / 2 - RAGGED - 1;
  const wander = 0.6 * Math.sin(row * 0.45 + t * 0.0007) + 0.4 * Math.sin(row * 1.7 - t * 0.0011 + 1.3);
  return from + (to - from) * progress + RAGGED * wander;
}

/** Which side of the seam a cell is on; near the seam the band mixes the two cell by cell. */
export function cellSide(c: number, r: number, seam: number): "photo" | "data" {
  return c <= seam + (hash(c, r) - 0.5) * BAND ? "photo" : "data";
}

/** A brief brightening on a sparse few cells, each on its own slow clock (0 most of the time). */
export function twinkle(c: number, r: number, t: number): number {
  const h = hash(c, r, 1);
  if (h > 0.03) return 0;
  const period = 1800 + h * 40000;
  const local = (t / period + hash(c, r, 2)) % 1;
  return local < 0.12 ? Math.sin((Math.PI * local) / 0.12) : 0;
}

/** 0 → 1 as a figure `height` tall, whose top is at `top`, crosses a viewport `vh` tall. */
export function scrollProgress(top: number, height: number, vh: number): number {
  const start = vh * 0.85;
  const end = vh * 0.15 - height * 0.6;
  return Math.min(1, Math.max(0, (start - top) / (start - end)));
}

/**
 * 0 → 1 across a tall section the figure is sticky in: 0 while the section's top is below the top
 * fifth of the screen, 1 once its bottom has risen to 80% of the screen.
 */
export function sectionProgress(top: number, height: number, vh: number): number {
  const run = height - vh * 0.6;
  if (run <= 0) return scrollProgress(top, height, vh);
  return Math.min(1, Math.max(0, (vh * 0.2 - top) / run));
}
