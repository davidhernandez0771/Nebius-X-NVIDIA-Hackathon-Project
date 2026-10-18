// The hero's fast swarm: small robot-gripper copies of the hand's pinch, on a stepped lattice that
// fans out ahead of the pinch point. One copy at first; every pinch multiplies them (×4) up to a cap,
// each new copy splitting off an existing one. Pure (positions in px relative to the pinch, time in ms), so
// HeroCanvas.tsx only draws it.
import { seeded } from "../../../sant/motion/dust";

export type Slot = { x: number; y: number; row: number; depth: number };
export type Body = { x: number; y: number; vx: number; vy: number };

/**
 * Lattice slots in the wedge's own frame: +x points away from the pinch, rows are `spacing` apart
 * in a hex step (odd rows shift half a step), and a row holds what fits within `spread` of the axis.
 * Nearer rows first, so the first copies sit by the hand.
 */
export function buildSlots(count: number, { spacing, spread, seed = 7 }: { spacing: number; spread: number; seed?: number }): Slot[] {
  const rnd = seeded(seed);
  const rowGap = spacing * 0.87;
  const slots: Slot[] = [];
  for (let row = 1; slots.length < count; row++) {
    const x = row * rowGap;
    const half = x * spread + spacing * 0.5;
    const shift = row % 2 ? spacing / 2 : 0;
    const lateral: number[] = [];
    for (let k = -Math.ceil(half / spacing) - 1; k <= Math.ceil(half / spacing) + 1; k++) {
      const y = k * spacing + shift;
      if (Math.abs(y) <= half) lateral.push(y);
    }
    lateral.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
    for (const y of lateral) {
      if (slots.length === count) break;
      // A little hand-placed mess, well under half the spacing, so neighbours never touch.
      slots.push({ x: x + (rnd() - 0.5) * spacing * 0.24, y: y + (rnd() - 0.5) * spacing * 0.24, row, depth: 0 });
    }
  }
  const last = slots[slots.length - 1].row;
  for (const s of slots) s.depth = Math.min(1, Math.max(0, (s.row / last) * 0.85 + (rnd() - 0.5) * 0.4));
  return slots;
}

/** How many copies after `pinches` pinches: 1, then ×`factor` on each pinch, up to `cap`. */
export function population(pinches: number, cap: number, factor = 4): number {
  return Math.min(cap, factor ** Math.min(pinches, 15));
}

/** The copy that newborn `k` splits off, when the swarm grows from `before` copies. */
export function parentOf(k: number, before: number): number {
  return (k - before) % before;
}

/** The heavy hand's rhythm, in ms: first close, then one close per period. */
export const CYCLE = { first: 900, period: 2400, close: 700, hold: 350, open: 900 } as const;

const inOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

/** The pinch amount at time t, and how many closes have happened by then. */
export function pinchCycle(t: number): { pinch: number; closes: number } {
  const closes = t < CYCLE.first ? 0 : Math.floor((t - CYCLE.first) / CYCLE.period) + 1;
  if (closes > 0) {
    const u = t - (CYCLE.first + (closes - 1) * CYCLE.period);
    if (u < CYCLE.hold) return { pinch: 1, closes };
    if (u < CYCLE.hold + CYCLE.open) return { pinch: 1 - inOut((u - CYCLE.hold) / CYCLE.open), closes };
  }
  const v = CYCLE.first + closes * CYCLE.period - t;
  return { pinch: v < CYCLE.close ? inOut(1 - v / CYCLE.close) : 0, closes };
}

const K = 170;
const C = 2 * Math.sqrt(K) * 0.85;

/** A fast, nearly critically damped follow. Long frames are capped so a returning tab can't explode it. */
export function springStep(b: Body, target: { x: number; y: number }, dt: number): Body {
  let { x, y, vx, vy } = b;
  let left = Math.min(dt, 0.1);
  while (left > 0) {
    const h = Math.min(left, 1 / 120);
    vx += (K * (target.x - x) - C * vx) * h;
    vy += (K * (target.y - y) - C * vy) * h;
    x += vx * h;
    y += vy * h;
    left -= h;
  }
  return { x, y, vx, vy };
}
