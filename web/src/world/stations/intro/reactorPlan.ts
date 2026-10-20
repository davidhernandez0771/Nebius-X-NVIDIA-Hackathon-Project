// The reactor's layout and how it powers up, pure: the rings round the core and how fast they spin,
// the cables from the cavern's wall to the core's sockets and the order they light in, the particles'
// orbit speed, and the top ring lifting off the core into THE RING. storyPlan.ts says how much power
// there is at each scroll; Reactor.tsx draws it.
import type { Vec3 } from "../../core/types";
import { CAVERN, CORE, THE_RING, TOP_RING, type RingPlace } from "./layout";
import { seeded } from "./particles";

const [AX, AZ] = CAVERN.axis;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface CoreRing {
  y: number;
  radius: number;
  /** A small tilt (radians), so the spin shows as a wobble too. */
  tilt: number;
  /** Which way it turns (1 or -1). */
  dir: number;
}

/** The rings round the core, under its top ring (which is THE RING to be). */
export const RINGS: readonly CoreRing[] = [
  { y: 43, radius: 3.7, tilt: 0.05, dir: 1 },
  { y: 37.5, radius: 4.4, tilt: -0.07, dir: -1 },
  { y: 32, radius: 3.9, tilt: 0.06, dir: 1 },
  { y: 26.5, radius: 4.8, tilt: -0.04, dir: -1 },
];

/** The rings' spin (radians a second): a slow drift when dormant, a whir at full power. */
export const ringSpeed = (power: number) => 0.08 + 6 * clamp01(power) ** 2;

/** The particles' orbit speed round the core (radians a second). */
export const particleSpeed = (power: number) => 0.15 + 2.6 * clamp01(power) ** 1.5;

/** The top ring at `lift` 0–1: resting round the core's cap, then up and wider into THE RING. */
export function ringPose(lift: number): RingPlace {
  if (lift <= 0) return TOP_RING;
  if (lift >= 1) return THE_RING;
  const l = (a: number, b: number) => a + (b - a) * lift;
  return {
    center: [l(TOP_RING.center[0], THE_RING.center[0]), l(TOP_RING.center[1], THE_RING.center[1]), l(TOP_RING.center[2], THE_RING.center[2])],
    radius: l(TOP_RING.radius, THE_RING.radius),
  };
}

/** A cable: a cubic curve from its anchor on the cavern's wall (p0) to its socket on the core (p3). */
export interface Cable {
  p0: Vec3;
  p1: Vec3;
  p2: Vec3;
  p3: Vec3;
}

function makeCables(n: number): Cable[] {
  const rnd = seeded(41);
  const out: Cable[] = [];
  for (let i = 0; i < n; i++) {
    // Round the cavern in order, so they light up as a sweep.
    const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
    const wy = 30 + rnd() * 28;
    const sy = CORE.bottom + 4 + rnd() * (CORE.top - CORE.bottom - 8);
    const sa = a + (rnd() - 0.5) * 0.6;
    const wr = CAVERN.radius - 0.4;
    const sr = CORE.radius + 0.25;
    const p0: Vec3 = [AX + Math.sin(a) * wr, wy, AZ + Math.cos(a) * wr];
    const p3: Vec3 = [AX + Math.sin(sa) * sr, sy, AZ + Math.cos(sa) * sr];
    // Sagging under its own weight, then rising into the socket.
    const sag = 7 + rnd() * 6;
    const p1: Vec3 = [AX + Math.sin(a) * wr * 0.62, Math.max(CAVERN.floor + 2, wy - sag), AZ + Math.cos(a) * wr * 0.62];
    const p2: Vec3 = [AX + Math.sin(sa) * (sr + 5), Math.max(CAVERN.floor + 2, sy - sag * 0.6), AZ + Math.cos(sa) * (sr + 5)];
    out.push({ p0, p1, p2, p3 });
  }
  return out;
}

export const CABLES: readonly Cable[] = makeCables(14);

/** A point on a cable, s 0 (the wall) to 1 (the core). */
export function cablePoint(c: Cable, s: number): Vec3 {
  const u = 1 - s;
  const w = [u * u * u, 3 * u * u * s, 3 * u * s * s, s * s * s];
  const k = (i: number) => w[0] * c.p0[i] + w[1] * c.p1[i] + w[2] * c.p2[i] + w[3] * c.p3[i];
  return [k(0), k(1), k(2)];
}

/** 0–1: how lit cable i of n is at a power: they come on one after another, all lit before full power. */
export function cableLight(i: number, n: number, power: number): number {
  const on = 0.06 + (0.8 * i) / Math.max(1, n - 1);
  return smooth(on, on + 0.08, power);
}
