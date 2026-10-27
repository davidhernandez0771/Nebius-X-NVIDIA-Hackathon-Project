// The proof beats' graphs as pure functions of `draw`, the share of a beat's graph the scroll has drawn (0–1,
// storyPlan.ts proofBeatState): which pipeline steps are lit, how far each of the climb's bars has grown, the last
// checkpoint the teacher curve has reached and how many cells of the speed gate's tallies are filled. ProofBeats.tsx
// writes them to the DOM; with reduced motion it passes draw = 1, the final state.
import { smoother } from "../../core/rail";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 0–1: how lit step i of n is. Each lights over its own n-th of the draw, in order. */
export const stepLight = (draw: number, i: number, n: number) => clamp01(draw * n - i);

/** Each bar grows over this share of the draw; the starts are spread so the last ends at 1. */
const BAR_SPAN = 0.4;

/** 0–1: how far bar i of n has grown (eased), one after another. */
export function barGrow(draw: number, i: number, n: number): number {
  const start = n > 1 ? ((1 - BAR_SPAN) * i) / (n - 1) : 0;
  return smoother((draw - start) / BAR_SPAN);
}

/** The index of the last checkpoint (x 0–1, ascending) the curve's drawn edge has reached. */
export function curveReached(draw: number, xs: readonly number[]): number {
  let last = 0;
  xs.forEach((x, i) => {
    if (draw >= x - 1e-9) last = i;
  });
  return last;
}

/** The gate's two tallies: before the speed cap, then after. */
export const TALLY_ROWS = 2;
/** Row 0 fills over [0, 0.45] of the draw, row 1 over [0.55, 1]: a beat between them. */
const ROW_SPANS: readonly (readonly [number, number])[] = [
  [0, 0.45],
  [0.55, 1],
];

/** How many of row `row`'s n cells are filled (a whole number). */
export function tallyCount(draw: number, row: number, n: number): number {
  const [a, b] = ROW_SPANS[row];
  return Math.round(n * clamp01((draw - a) / (b - a)));
}
