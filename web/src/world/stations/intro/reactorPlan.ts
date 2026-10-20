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

/** A junction box on the cavern's wall: several cables leave it together for the core. */
export interface Junction {
  pos: Vec3;
  /** Its direction round the axis (rad), so it faces the core. */
  angle: number;
}

/** A cable: a cubic curve from its anchor on a junction box (p0) to its socket on the core (p3). */
export interface Cable {
  p0: Vec3;
  p1: Vec3;
  p2: Vec3;
  p3: Vec3;
  /** Which junction box it leaves from. */
  junction: number;
}

const JUNCTION_COUNT = 7;
const CABLES_PER_JUNCTION = 4;

function makeJunctions(): Junction[] {
  const rnd = seeded(43);
  const wr = CAVERN.radius - 0.6;
  return Array.from({ length: JUNCTION_COUNT }, (_, j) => {
    const angle = (j / JUNCTION_COUNT) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
    const y = 34 + rnd() * 20;
    return { pos: [AX + Math.sin(angle) * wr, y, AZ + Math.cos(angle) * wr] as Vec3, angle };
  });
}

/** The junction boxes, round the cavern in order. */
export const JUNCTIONS: readonly Junction[] = makeJunctions();

function makeCables(): Cable[] {
  const rnd = seeded(41);
  const out: Cable[] = [];
  JUNCTIONS.forEach((box, junction) => {
    for (let k = 0; k < CABLES_PER_JUNCTION; k++) {
      // Leaving the box side by side, then fanning out round the core: they light up as a sweep round the cavern.
      const spread = (k - (CABLES_PER_JUNCTION - 1) / 2) * 0.22;
      const a = box.angle + spread / (CAVERN.radius - 0.6);
      const wy = box.pos[1] + (rnd() - 0.5) * 0.5;
      const sy = CORE.bottom + 4 + rnd() * (CORE.top - CORE.bottom - 8);
      const sa = box.angle + (k - 1.5) * 0.18 + (rnd() - 0.5) * 0.2;
      const wr = CAVERN.radius - 0.9;
      const sr = CORE.radius + 0.25;
      const p0: Vec3 = [AX + Math.sin(a) * wr, wy, AZ + Math.cos(a) * wr];
      const p3: Vec3 = [AX + Math.sin(sa) * sr, sy, AZ + Math.cos(sa) * sr];
      // Sagging under its own weight, then rising into the socket.
      const sag = 7 + rnd() * 6;
      const p1: Vec3 = [AX + Math.sin(a) * wr * 0.62, Math.max(CAVERN.floor + 2, wy - sag), AZ + Math.cos(a) * wr * 0.62];
      const p2: Vec3 = [AX + Math.sin(sa) * (sr + 5), Math.max(CAVERN.floor + 2, sy - sag * 0.6), AZ + Math.cos(sa) * (sr + 5)];
      out.push({ p0, p1, p2, p3, junction });
    }
  });
  return out;
}

export const CABLES: readonly Cable[] = makeCables();

/** A point on a cable, s 0 (the wall) to 1 (the core). */
export function cablePoint(c: Cable, s: number): Vec3 {
  const u = 1 - s;
  const w = [u * u * u, 3 * u * u * s, 3 * u * s * s, s * s * s];
  const k = (i: number) => w[0] * c.p0[i] + w[1] * c.p1[i] + w[2] * c.p2[i] + w[3] * c.p3[i];
  return [k(0), k(1), k(2)];
}

const cableOn = (i: number, n: number) => 0.06 + (0.8 * i) / Math.max(1, n - 1);

/** 0–1: how lit cable i of n is at a power: they come on one after another, all lit before full power. */
export function cableLight(i: number, n: number, power: number): number {
  const on = cableOn(i, n);
  return smooth(on, on + 0.08, power);
}

/** 0–1: how far along cable i (from the wall) the charge has run at a power. It runs ahead of cableLight, so the
 *  light fills a cable from its junction box to the core as you scroll, and drains back the same way. */
export function cableFront(i: number, n: number, power: number): number {
  const on = cableOn(i, n);
  return smooth(on - 0.04, on + 0.06, power);
}

/** How fast the pulses run along a lit cable (cable lengths a second), quickening with the power. */
export const pulseSpeed = (power: number) => 0.6 + 4.4 * clamp01(power);

/** Clamps along each cable, at even steps between its ends. */
export const CLAMPS_PER_CABLE = 4;

/** Where a cable's clamps sit: s along it, the point, and the cable's direction there. */
export function clampsOf(c: Cable): { s: number; pos: Vec3; dir: Vec3 }[] {
  return Array.from({ length: CLAMPS_PER_CABLE }, (_, k) => {
    const s = (k + 1) / (CLAMPS_PER_CABLE + 1);
    const a = cablePoint(c, s - 0.005);
    const b = cablePoint(c, s + 0.005);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    return { s, pos: cablePoint(c, s), dir: [d[0] / len, d[1] / len, d[2] / len] as Vec3 };
  });
}

/** The core's outer panels (between the cage's ribs, with vents that glow with the power). */
export const CORE_PANELS = 12;
/** Bolts round each ring. */
export const RING_BOLTS = 16;

/** 0–1: how many sparks fly, only near full power, most as the top ring lifts into THE RING. */
export function sparkRate(power: number, lift: number): number {
  return smooth(0.9, 1, power) * (0.35 + 0.65 * clamp01(lift));
}
