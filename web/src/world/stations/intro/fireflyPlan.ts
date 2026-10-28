// The forest's fireflies: a few hundred real ones, not dust: each a small hot body in a glow and a soft halo the size
// of a hand, flashing on its own rhythm (a quick flash, a slower fade, a dim ember between) and wandering like an
// insect (slow loops and a small quick jitter). Pale tints, led by warm gold, with cool accents. Most drift along
// the walk; some circle the fallen robots, as if the robots were waking up; some wait round the crack and swirl into
// it as the camera comes, then fall with it; a few large out-of-focus ones hang near the camera's way; and LANTERNS
// of them, low over the walk, really light the moss, the bark and the robots round them (placeShaders.ts uGlowP).
// This plans where each one starts and what it does; fireflies.ts moves and blinks them all in the shader, one draw,
// with driftAt and blinkAt here as the shader's mirror (the lanterns' light follows them on the CPU). Seeded, so
// every visit is the same.
import * as THREE from "three";
import type { TierName } from "../../core/quality";
import type { ForestLayout } from "./forestGeometry";
import { crackHalfWidth, inCrack } from "./forestPlan";
import type { RobotId } from "./forestRobots";
import { CRACK, FOREST } from "./layout";
import { seeded } from "./particles";
import { PLACE_GLOWS } from "./placeShaders";
import { walkXZ } from "./path";

/** The colours: pale tints, warm gold first; none near green (the brand keeps hues 70–100° for NVIDIA's own). */
export const FIREFLY_PALETTE = [
  { name: "gold", hex: "#ffe2a0", weight: 0.3, warm: true },
  { name: "amber", hex: "#ffc078", weight: 0.16, warm: true },
  { name: "coral", hex: "#ffb0b8", weight: 0.08, warm: true },
  { name: "teal", hex: "#9ff3e6", weight: 0.2, warm: false },
  { name: "ice", hex: "#c6e6ff", weight: 0.14, warm: false },
  { name: "violet", hex: "#cdb8ff", weight: 0.12, warm: false },
] as const;

/** Fewer than dust and larger: each one is seen. */
export const FIREFLY_COUNTS = { ultra: 420, high: 300, low: 120, phone: 90 } as const;

/** How many fireflies light the forest round them (as many as the place shaders take). */
export const LANTERNS = PLACE_GLOWS;

/** The glow left between flashes (of the flash's 1). */
export const BLINK_EMBER = 0.07;

type Rand = readonly [number, number, number, number] | readonly number[];

/**
 * Where a firefly has wandered from its start at time t (m): two slow loops on top of each other, never the same
 * twice, a slow bob, and a small quick jitter (an insect's flight). fireflies.ts's vertex shader mirrors this.
 */
export function driftAt(r: Rand, t: number): [number, number, number] {
  const ph = r[1] * Math.PI * 2, s = r[2];
  return [
    Math.sin(t * (0.11 + 0.09 * s) + ph) * 1.3 + Math.sin(t * 0.05 + ph * 2) * 0.9 + 0.05 * Math.sin(t * (2.9 + 1.3 * s) + ph * 7),
    Math.sin(t * (0.19 + 0.1 * s) + ph * 1.3) * 0.45 + 0.04 * Math.sin(t * (3.7 + s) + ph * 11),
    Math.cos(t * (0.09 + 0.08 * s) + ph) * 1.3 + Math.cos(t * 0.04 + ph * 3) * 0.9 + 0.05 * Math.cos(t * (3.1 + 0.9 * s) + ph * 5),
  ];
}

const smooth = (a: number, b: number, v: number) => {
  const k = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** How bright a firefly is at time t (BLINK_EMBER to 1): a flash every few seconds, some of them a double flash. */
export function blinkAt(r: Rand, t: number): number {
  const period = 2.6 + 3.4 * r[0];
  const x = t / period + r[1] * 7.31;
  const ph = x - Math.floor(x);
  const flash = (p: number) => smooth(0, 0.06, p) * (1 - smooth(0.06, 0.32, p));
  const f = Math.max(flash(ph), r[3] > 0.6 ? 0.7 * flash(ph - 0.38) : 0);
  return BLINK_EMBER + (1 - BLINK_EMBER) * f;
}

export const fireflyCount = (tier: TierName, phone: boolean) => (phone ? FIREFLY_COUNTS.phone : FIREFLY_COUNTS[tier]);

/** The crack's fireflies (those that fall with the camera) on top of those: as many as the fall has always had. */
export const CRACK_FIREFLIES = { ultra: 180, high: 120, low: 36, phone: 24 } as const;

export const crackFireflyCount = (tier: TierName, phone: boolean) => (phone ? CRACK_FIREFLIES.phone : CRACK_FIREFLIES[tier]);

/** What each one does (its value in the `kind` attribute). */
export const KIND = { drift: 0, robot: 1, crack: 2, bokeh: 3, lantern: 4 } as const;
export type FireflyKind = keyof typeof KIND;

export interface Fireflies {
  count: number;
  /** Where each starts (world m). */
  position: Float32Array;
  /** What each one circles: its robot's spot on the floor (robot ones), else unused. */
  center: Float32Array;
  color: Float32Array;
  kind: Float32Array;
  /** Per firefly: blink rhythm, phase, path seed, size (0–1 each). */
  rand: Float32Array;
}

const F = FOREST.floor;
const DIR = [Math.cos(CRACK.angle), -Math.sin(CRACK.angle)] as const;
const ACROSS = [Math.sin(CRACK.angle), Math.cos(CRACK.angle)] as const;

/** `count` fireflies over the forest of `layout`, the robot ones round the spots of `robots`; `crack` of them wait at
 *  the crack (by default an eighth). */
export function fireflies(count: number, layout: ForestLayout, robots: readonly RobotId[], crack = Math.round(count * 0.12)): Fireflies {
  const rnd = seeded(4417);
  const walk = walkXZ();
  const ground = walk.slice(Math.floor(walk.length * 0.3));
  const spots = layout.robots.filter((s) => robots.includes(s.id));
  const perRobot = Math.max(4, Math.round((count * 0.1) / Math.max(1, spots.length)));
  const nLantern = Math.min(count, LANTERNS);
  const nRobot = Math.min(count - nLantern, perRobot * spots.length);
  const nCrack = Math.min(crack, count - nLantern - nRobot);
  const nBokeh = Math.round(count * 0.025);
  const kinds: FireflyKind[] = [];
  for (let i = 0; i < count; i++) {
    const k = i - nLantern;
    kinds.push(k < 0 ? "lantern" : k < nRobot ? "robot" : k < nRobot + nCrack ? "crack" : k < nRobot + nCrack + nBokeh ? "bokeh" : "drift");
  }

  const total = FIREFLY_PALETTE.reduce((s, c) => s + c.weight, 0);
  const colors = FIREFLY_PALETTE.map((c) => new THREE.Color(c.hex));
  const pick = () => {
    let r = rnd() * total;
    for (let k = 0; k < FIREFLY_PALETTE.length; k++) if ((r -= FIREFLY_PALETTE[k].weight) <= 0) return colors[k];
    return colors[0];
  };
  const along = () => ground[Math.floor(rnd() * ground.length)];

  const out: Fireflies = {
    count,
    position: new Float32Array(count * 3),
    center: new Float32Array(count * 3),
    color: new Float32Array(count * 3),
    kind: new Float32Array(count),
    rand: new Float32Array(count * 4),
  };
  kinds.forEach((k, i) => {
    let p: [number, number, number];
    if (k === "lantern") {
      // Spread along the walk, a step or two to its side, low: their light falls on the moss and the trunks' feet.
      const j = Math.min(ground.length - 2, Math.floor(((i + 0.5) / nLantern) * (ground.length - 1)));
      const [ax, az] = ground[j];
      const [bx, bz] = ground[j + 1];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const side = i % 2 ? 1 : -1;
      do {
        const off = side * (1.2 + rnd() * 2);
        p = [ax - ((bz - az) / len) * off, F + 0.8 + rnd() * 1.1, az + ((bx - ax) / len) * off];
      } while (inCrack(p[0], p[2], -0.5));
    } else if (k === "robot") {
      const s = spots[i % spots.length];
      out.center.set([s.x, F, s.z], i * 3);
      const a = rnd() * Math.PI * 2;
      p = [s.x + Math.cos(a) * 1.2, F + 0.4 + rnd() * 1.2, s.z + Math.sin(a) * 1.2];
    } else if (k === "crack") {
      // Over the lens and up to a couple of metres past its lip.
      const u = (rnd() * 2 - 1) * CRACK.halfLength * 0.85;
      const v = (rnd() * 2 - 1) * (crackHalfWidth(u) + 2);
      p = [CRACK.center[0] + u * DIR[0] + v * ACROSS[0], F + 0.3 + rnd() * 2.2, CRACK.center[1] + u * DIR[1] + v * ACROSS[1]];
    } else {
      const spread = k === "bokeh" ? 2.5 : 7;
      do {
        const [x, z] = along();
        p = [x + (rnd() * 2 - 1) * spread, k === "bokeh" ? F + 1.2 + rnd() * 1.8 : F + 0.4 + rnd() ** 1.6 * 7, z + (rnd() * 2 - 1) * spread];
      } while (inCrack(p[0], p[2], -0.5));
    }
    out.position.set(p, i * 3);
    out.color.set(pick().toArray(), i * 3);
    out.kind[i] = KIND[k];
    out.rand.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  });
  return out;
}
