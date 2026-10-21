// The forest's fireflies: small glowing points in many colours (mostly cool, with warm accents) over the forest
// floor. Most drift on slow curving paths along the walk; some circle the fallen robots, as if the robots were
// waking up; some wait round the crack and swirl into it as the camera comes, then fall with it; a few large
// out-of-focus ones hang near the camera's way. This plans where each one starts and what it does (its kind, its
// colour, its rhythm); fireflies.ts moves and blinks them all in the shader, one draw. Seeded, so every visit is
// the same.
import * as THREE from "three";
import type { TierName } from "../../core/quality";
import type { ForestLayout } from "./forestGeometry";
import { crackHalfWidth, inCrack } from "./forestPlan";
import type { RobotId } from "./forestRobots";
import { CRACK, FOREST } from "./layout";
import { seeded } from "./particles";
import { walkXZ } from "./path";

/** The colours: none near green (the brand keeps hues 70–100° for NVIDIA's own), mostly cool. */
export const FIREFLY_PALETTE = [
  { name: "teal", hex: "#3fe8d8", weight: 0.26, warm: false },
  { name: "ice", hex: "#a8dcff", weight: 0.18, warm: false },
  { name: "violet", hex: "#b18cff", weight: 0.16, warm: false },
  { name: "amber", hex: "#ffb04a", weight: 0.14, warm: true },
  { name: "gold", hex: "#ffe6a3", weight: 0.12, warm: true },
  { name: "coral", hex: "#ff7f8f", weight: 0.14, warm: true },
] as const;

export const FIREFLY_COUNTS = { ultra: 1500, high: 1000, low: 300, phone: 200 } as const;

export const fireflyCount = (tier: TierName, phone: boolean) => (phone ? FIREFLY_COUNTS.phone : FIREFLY_COUNTS[tier]);

/** What each one does (its value in the `kind` attribute). */
export const KIND = { drift: 0, robot: 1, crack: 2, bokeh: 3 } as const;
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

/** `count` fireflies over the forest of `layout`, the robot ones round the spots of `robots`. */
export function fireflies(count: number, layout: ForestLayout, robots: readonly RobotId[]): Fireflies {
  const rnd = seeded(4417);
  const walk = walkXZ();
  const ground = walk.slice(Math.floor(walk.length * 0.3));
  const spots = layout.robots.filter((s) => robots.includes(s.id));
  const perRobot = Math.max(6, Math.round((count * 0.1) / Math.max(1, spots.length)));
  const nRobot = Math.min(count, perRobot * spots.length);
  const nCrack = Math.round(count * 0.12);
  const nBokeh = Math.round(count * 0.04);
  const kinds: FireflyKind[] = [];
  for (let i = 0; i < count; i++) kinds.push(i < nRobot ? "robot" : i < nRobot + nCrack ? "crack" : i < nRobot + nCrack + nBokeh ? "bokeh" : "drift");

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
    if (k === "robot") {
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
