// The power-on's dust (docs/design/motion.md §4): specks scattered over the screen gather into
// the S·A·N·T mark, one unit after another, and each unit lights as its dust lands. The paths are
// pure functions of time, so PowerOn.tsx only draws them and the tests need no canvas.
import { ease } from "./tokens";

export type Pt = { x: number; y: number };
export type Particle = { sx: number; sy: number; tx: number; ty: number; vx: number; vy: number; unit: number; delay: number; curl: number };
/** Unit 0's dust starts at `at` and lands at `at + duration`; each next unit lands `stagger` later. */
export type DustTiming = { at: number; duration: number; stagger: number; fade: number };

/** mulberry32: a small seeded generator, so a run can be repeated. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Opaque pixels of an alpha mask (canvas ImageData), visited every `step` pixels. */
export function sampleMask(mask: { width: number; height: number; data: ArrayLike<number> }, step: number, threshold = 128): Pt[] {
  const pts: Pt[] = [];
  for (let y = 0; y < mask.height; y += step) {
    for (let x = 0; x < mask.width; x += step) {
      if (mask.data[(y * mask.width + x) * 4 + 3] >= threshold) pts.push({ x, y });
    }
  }
  return pts;
}

/** One speck per target point; `targets[u]` are the points of unit u. */
export function makeDust(targets: Pt[][], { width, height, seed, maxDelay = 120 }: { width: number; height: number; seed: number; maxDelay?: number }): Particle[] {
  const rnd = seeded(seed);
  const dust: Particle[] = [];
  targets.forEach((pts, unit) => {
    for (const t of pts) {
      dust.push({
        sx: rnd() * width,
        sy: rnd() * height,
        tx: t.x,
        ty: t.y,
        vx: (rnd() * 2 - 1) * 24,
        vy: (rnd() * 2 - 1) * 24,
        unit,
        delay: rnd() * maxDelay,
        curl: (rnd() * 2 - 1) * 70,
      });
    }
  });
  return dust;
}

const emph = ease("emph");

/** Where a speck is at time t (ms since the power-on started), and how visible. */
export function dustPoint(p: Particle, t: number, timing: DustTiming): { x: number; y: number; alpha: number } {
  const start = timing.at + p.unit * timing.stagger + p.delay;
  const span = timing.duration - p.delay;
  const land = start + span;
  const raw = Math.min(1, Math.max(0, (t - start) / span));
  // emph never overshoots, so a speck stops on its target instead of bouncing past it.
  const e = raw >= 1 ? 1 : emph(raw);
  const drift = Math.min(t, start) / 1000;
  const x0 = p.sx + p.vx * drift;
  const y0 = p.sy + p.vy * drift;
  const dx = p.tx - x0;
  const dy = p.ty - y0;
  const len = Math.hypot(dx, dy) || 1;
  const swirl = p.curl * Math.sin(Math.PI * e);
  const x = x0 + dx * e - (dy / len) * swirl;
  const y = y0 + dy * e + (dx / len) * swirl;
  const alpha = t <= land ? 0.35 + 0.65 * e : Math.max(0, 1 - (t - land) / timing.fade);
  return { x, y, alpha };
}
