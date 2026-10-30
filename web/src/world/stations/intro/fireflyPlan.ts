// The forest's fireflies: a few hundred real ones, not dust: each a small hot body in a glow and a soft halo the size
// of a hand, flashing on its own rhythm (a quick flash, a slower fade, a dim ember between) and wandering like an
// insect (slow loops and a small quick jitter). Pale tints, led by warm gold, with cool accents. Most drift along
// the walk; some circle the fallen robots, as if the robots were waking up; some wait round the crack and swirl into
// it as the camera comes, then fall with it; a few large out-of-focus ones hang near the camera's way; and LANTERNS
// of them, low over the walk, really light the moss, the bark and the robots round them (placeShaders.ts uGlowP).
// This plans where each one starts and what it does; fireflies.ts moves and blinks them all in the shader, one draw,
// with driftAt and blinkAt here as the shader's mirror (the lanterns' light follows them on the CPU). Seeded, so
// every visit is the same.
// They don't fly through things (polish, 2026-10-27, the user: "fireflies overlap and go through the meshes"): the
// trunks, the fallen logs and the robots are solids (vertical cylinders, solids()), each firefly carries the few
// nearest its home, and settle() (mirrored in the shader) pushes it out of them and keeps it over the floor; the
// robot ones circle clear of their robot; and one close to a surface draws a smaller halo (clearance()), so its glow
// doesn't cut into the bark.
import * as THREE from "three";
import type { TierName } from "../../core/quality";
import type { ForestLayout } from "./forestGeometry";
import { crackHalfWidth, inCrack } from "./forestPlan";
import { robotSolid, type RobotId } from "./forestRobots";
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

/**
 * Something solid in the forest a firefly keeps out of: a vertical cylinder on the floor round (x, z), `r` metres
 * (its keep-out radius: the thing's own and SOLID_MARGIN), up to `top` (world y; a trunk's is far overhead).
 */
export interface Solid {
  x: number;
  z: number;
  r: number;
  top: number;
  /** The fallen log it is part of (a log is a row of them). */
  log?: number;
}

/** How far a firefly keeps from a solid's surface (m). */
export const SOLID_MARGIN = 0.3;
/** How low a firefly flies over the floor (m): over the moss mounds and the ferns' tips. */
export const FLOOR_CLEAR = 0.5;
/** How many solids each firefly keeps out of: those its path comes nearest (the shader's aSolid0..aSolid5). */
export const SOLIDS_EACH = 6;
/** How long a stretch of each one's wandering fits it among the solids (s; sampled every WANDER_STEP s): its slow
 *  loops come round in two to three minutes, and nobody stays in the forest that long. */
export const WANDER_S = 240;
const WANDER_STEP = 2;
/** A trunk's keep-out over its radius at chest height: the flare at its foot and its lean over the fireflies' height. */
export const TRUNK_FLARE = 1.3;
const TRUNK_LEAN = 0.32;
/** No solid (padding): never in the way. */
const NONE: Solid = { x: 0, z: 0, r: 0, top: -1e4 };
/** settle()'s passes over the solids: a firefly squeezed between two settles into the gap. */
export const PASSES = 6;

/** The forest's solids: its trunks (near and far), its fallen logs (a row of cylinders along each) and its robots. */
export function solids(layout: ForestLayout, robots: readonly RobotId[]): Solid[] {
  const F = FOREST.floor;
  const out: Solid[] = [];
  for (const t of [...layout.trees, ...layout.far]) out.push({ x: t.x, z: t.z, r: t.radius * TRUNK_FLARE + TRUNK_LEAN + SOLID_MARGIN, top: F + 100 });
  for (const [li, l] of layout.logs.entries()) {
    const r = l.radius + SOLID_MARGIN;
    const top = F + l.radius * (1 - 2 * l.sink) + l.radius + SOLID_MARGIN;
    const n = Math.max(2, Math.ceil(l.length / (r * 0.7)) + 1);
    for (let k = 0; k < n; k++) {
      const u = (k / (n - 1) - 0.5) * l.length;
      out.push({ x: l.x + Math.cos(l.yaw) * u, z: l.z + Math.sin(l.yaw) * u, r, top, log: li });
    }
  }
  for (const s of layout.robots) {
    if (!robots.includes(s.id)) continue;
    const { radius, height } = robotSolid(s);
    out.push({ x: s.x, z: s.z, r: radius + SOLID_MARGIN, top: F + height + SOLID_MARGIN });
  }
  return out;
}

/** A soft max (a smooth floor): b's value is reached gently, without a kink. */
const smax = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};

/** Out of one solid, sideways (a firefly slides round a trunk), fading out just under its top. */
function keepOut(p: [number, number, number], s: Solid): void {
  const dx = p[0] - s.x, dz = p[2] - s.z;
  const l = Math.hypot(dx, dz);
  if (l >= s.r) return;
  const w = 1 - smooth(s.top - 0.15, s.top + 0.15, p[1]);
  if (w <= 0) return;
  const nx = l > 1e-4 ? dx / l : 1, nz = l > 1e-4 ? dz / l : 0;
  p[0] += (s.x + nx * s.r - p[0]) * w;
  p[2] += (s.z + nz * s.r - p[2]) * w;
}

/**
 * Where a firefly at p really is: over the floor (softly) and out of its solids (two passes, so one squeezed between
 * two trunks settles between them). fireflies.ts's vertex shader mirrors this (keep them in step).
 */
export function settle(p: readonly number[], own: readonly Solid[], floor = FOREST.floor): [number, number, number] {
  const q: [number, number, number] = [p[0], smax(p[1], floor + FLOOR_CLEAR, 0.3), p[2]];
  for (let pass = 0; pass < PASSES; pass++) for (const s of own) keepOut(q, s);
  return q;
}

/** How far a firefly at p is from the nearest surface (m): its solids' own surfaces (inside the margin) and the floor. */
export function clearance(p: readonly number[], own: readonly Solid[], floor = FOREST.floor): number {
  let c = p[1] - floor;
  for (const s of own) if (p[1] < s.top) c = Math.min(c, Math.hypot(p[0] - s.x, p[2] - s.z) - (s.r - SOLID_MARGIN));
  return Math.max(0, c);
}

/** The solids a firefly keeps out of: SOLIDS_EACH of them, nearest first, padded with none. */
export function solidsOf(plan: Fireflies, i: number): Solid[] {
  return Array.from({ length: SOLIDS_EACH }, (_, k) => {
    const a = plan.solids[k];
    return { x: a[i * 4], z: a[i * 4 + 1], r: a[i * 4 + 2], top: a[i * 4 + 3] };
  });
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
  /** 4 per firefly. The robot ones: the middle of the circle they fly round their robot (its spot on the floor,
   *  moved off a trunk it would cross) and the circle's inner radius, clear of the robot. The rest: w scales how far
   *  it wanders (1, less in a tight spot between trunks). */
  center: Float32Array;
  color: Float32Array;
  kind: Float32Array;
  /** Per firefly: blink rhythm, phase, path seed, size (0–1 each). */
  rand: Float32Array;
  /** The solids it keeps out of: SOLIDS_EACH arrays, each 4 per firefly (x, z, r, top; solidsOf reads them). */
  solids: Float32Array[];
  /** 2 per firefly, the robot ones': the stretch of their circle clear of the trunks round their robot, its middle
   *  angle and half its width (rad); half π is the whole circle, round and round, else they swing to and fro on it. */
  arc: Float32Array;
}

/** A robot one's angle on its circle at time t (ω its speed, ph its phase), on the clear stretch (mid ± half). */
export function arcAngle(mid: number, half: number, ph: number, omega: number, t: number): number {
  return half >= FULL_ARC ? ph + omega * t : mid + half * Math.sin((omega * t) / Math.max(half, 0.01) + ph);
}
/** A clear stretch this wide is the whole circle. */
const FULL_ARC = 3.14;

/** A robot one's circle round its robot: from just clear of it out to about a metre more (w: 0–1, its rand). */
export const orbitRadius = (base: number, w: number) => base + 0.15 + 1.0 * w;

/**
 * Where firefly i wanders at time t before settle() puts it clear of its solids: the drifting ones (and the lanterns)
 * round home, the large soft ones a little less, the robot ones round their robot. fireflies.ts's vertex shader
 * mirrors this; not for the crack's (they swirl and fall).
 */
export function wanderAt(plan: Fireflies, i: number, t: number): [number, number, number] {
  const r = [plan.rand[i * 4], plan.rand[i * 4 + 1], plan.rand[i * 4 + 2], plan.rand[i * 4 + 3]] as const;
  if (plan.kind[i] === KIND.robot) {
    const ph = r[1] * Math.PI * 2, s = r[2];
    const a = arcAngle(plan.arc[i * 2], plan.arc[i * 2 + 1], ph, (0.18 + 0.25 * s) * (s > 0.5 ? 1 : -1), t);
    const rr = orbitRadius(plan.center[i * 4 + 3], r[3]);
    const y = 0.35 + 1.3 * fract(s * 7.3) + Math.sin(t * 0.6 + ph) * 0.25;
    return [
      plan.center[i * 4] + Math.cos(a) * rr + 0.05 * Math.sin(t * 2.9 + ph * 7),
      plan.center[i * 4 + 1] + y + 0.05 * Math.sin(t * 3.7 + ph * 11),
      plan.center[i * 4 + 2] + Math.sin(a) * rr + 0.05 * Math.cos(t * 3.1 + ph * 5),
    ];
  }
  const d = driftAt(r, t);
  const k = (plan.kind[i] === KIND.bokeh ? 0.6 : 1) * plan.center[i * 4 + 3];
  return [plan.position[i * 3] + d[0] * k, plan.position[i * 3 + 1] + d[1] * k, plan.position[i * 3 + 2] + d[2] * k];
}

/** The widest stretch of the circle round (cx, cz) of radius rr clear of `list` (its middle and half its width, rad;
 *  half π: all of it). */
function clearArc(cx: number, cz: number, rr: number, list: readonly Solid[]): { mid: number; half: number } {
  const M = 72;
  const free = Array.from({ length: M }, (_, j) => {
    const a = (j / M) * Math.PI * 2;
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    return list.every((s) => Math.hypot(x - s.x, z - s.z) > s.r + 0.08);
  });
  if (free.every(Boolean)) return { mid: 0, half: Math.PI };
  let best = { start: 0, len: 0 };
  for (let j = 0; j < M; j++) {
    if (!free[j] || free[(j + M - 1) % M]) continue;
    let len = 0;
    while (len < M && free[(j + len) % M]) len++;
    if (len > best.len) best = { start: j, len };
  }
  const step = (Math.PI * 2) / M;
  // A step in from each end (the samples between are unchecked).
  return { mid: (best.start + (best.len - 1) / 2) * step, half: Math.max(0, ((best.len - 1) / 2 - 1) * step) };
}

/** The 8 ways round, for nudging a home or a circle off the trunks. */
const WAYS = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)] as const);

const fract = (v: number) => v - Math.floor(v);

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
    center: new Float32Array(count * 4),
    color: new Float32Array(count * 3),
    kind: new Float32Array(count),
    rand: new Float32Array(count * 4),
    solids: Array.from({ length: SOLIDS_EACH }, () => new Float32Array(count * 4)),
    arc: new Float32Array(count * 2),
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
      // It circles clear of its robot (the robot's solid, margin and all, is the circle's inner edge).
      out.center.set([s.x, F, s.z, robotSolid(s).radius + SOLID_MARGIN], i * 4);
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
    if (k !== "robot") out.center[i * 4 + 3] = 1;
    out.color.set(pick().toArray(), i * 3);
    out.kind[i] = KIND[k];
    out.rand.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  });

  // Each fitted among the solids so its path never crosses one (a firefly pushed out of a trunk it flies straight
  // through would jump across it): a drifting one's home is nudged off the trunks and, in a tight spot, it wanders
  // less; a robot one's circle is moved (and widened, so it still clears the robot) to the clearest round it, and on
  // a circle a trunk crosses it swings to and fro along the clear stretch instead of going round. Settling (settle())
  // then only has grazes left to smooth. Then the solids each keeps out of: those its path comes
  // nearest. The crack's need none (the crack is clear of everything, and they fall).
  const all = solids(layout, robots);
  const walkAt = (x: number, z: number) => Math.min(...walk.map(([a, b]) => Math.hypot(a - x, b - z)));
  // A firefly's free path (wanderAt, sampled every WANDER_STEP s over WANDER_S), for any home and wander: its motion
  // once (unit), then placed as it is needed (pts).
  const N = Math.ceil(WANDER_S / WANDER_STEP);
  const unit = new Float64Array(N * 6);
  const pts = new Float64Array(N * 3);
  const prepare = (i: number) => {
    const r = [out.rand[i * 4], out.rand[i * 4 + 1], out.rand[i * 4 + 2], out.rand[i * 4 + 3]] as const;
    const ph = r[1] * Math.PI * 2, s = r[2];
    const kind = out.kind[i] === KIND.bokeh ? 0.6 : 1;
    for (let n = 0; n < N; n++) {
      const t = n * WANDER_STEP;
      if (out.kind[i] === KIND.robot) {
        const a = arcAngle(out.arc[i * 2], out.arc[i * 2 + 1], ph, (0.18 + 0.25 * s) * (s > 0.5 ? 1 : -1), t);
        const u = n * 6;
        unit[u] = Math.cos(a);
        unit[u + 1] = Math.sin(a);
        unit[u + 2] = 0.35 + 1.3 * fract(s * 7.3) + Math.sin(t * 0.6 + ph) * 0.25;
        unit[u + 3] = 0.05 * Math.sin(t * 2.9 + ph * 7);
        unit[u + 4] = 0.05 * Math.sin(t * 3.7 + ph * 11);
        unit[u + 5] = 0.05 * Math.cos(t * 3.1 + ph * 5);
      } else {
        const d = driftAt(r, t);
        unit[n * 6] = d[0] * kind;
        unit[n * 6 + 1] = d[1] * kind;
        unit[n * 6 + 2] = d[2] * kind;
      }
    }
  };
  // Sample n of firefly i's path from (x, z) wandering w, into pts.
  const at = (i: number, n: number, x: number, z: number, w: number, rr: number) => {
    const u = n * 6;
    if (out.kind[i] === KIND.robot) {
      pts[n * 3] = x + unit[u] * rr + unit[u + 3];
      pts[n * 3 + 1] = F + unit[u + 2] + unit[u + 4];
      pts[n * 3 + 2] = z + unit[u + 1] * rr + unit[u + 5];
    } else {
      pts[n * 3] = x + unit[u] * w;
      pts[n * 3 + 1] = out.position[i * 3 + 1] + unit[u + 1] * w;
      pts[n * 3 + 2] = z + unit[u + 2] * w;
    }
  };
  /** How deep firefly i's path from (x, z) wandering w goes into any of `list`'s keep-outs (0: clear, 1: through its
   *  middle; as a share of its radius), given up once past `enough`. */
  const depthIn = (i: number, x: number, z: number, w: number, list: readonly Solid[], enough = Infinity) => {
    const rr = orbitRadius(w, out.rand[i * 4 + 3]);
    let d = 0;
    for (let n = 0; n < N && list.length; n++) {
      at(i, n, x, z, w, rr);
      const px = pts[n * 3], py = pts[n * 3 + 1], pz = pts[n * 3 + 2];
      let into = 0;
      for (const s of list)
        if (py < s.top) {
          const v = 1 - Math.hypot(px - s.x, pz - s.z) / s.r;
          if (v > 0) into++;
          d = Math.max(d, v);
        }
      // In two at once (where two trunks' keep-outs meet) there is no smooth way round: as deep as through a middle.
      if (into > 1) d = 1;
      if (d > enough) return d;
    }
    return d;
  };

  kinds.forEach((k, i) => {
    let own: Solid[] = [];
    if (k !== "crack") {
      prepare(i);
      const robot = k === "robot";
      const c = i * 4, q = i * 3;
      const ox = robot ? out.center[c] : out.position[q];
      const oz = robot ? out.center[c + 2] : out.position[q + 2];
      const base = robot ? out.center[c + 3] : 1;
      const mine = robot ? all.find((s) => s.x === ox && s.z === oz) : undefined;
      // Everything any of the tries below could reach.
      const around = all.filter((s) => s !== mine && Math.hypot(s.x - ox, s.z - oz) - s.r < (robot ? orbitRadius(base + 2.4, 1) + 2.4 : 9.7));
      const tries: [number, number, number][] = [];
      for (const shift of robot ? [0, 0.6, 1.2, 1.8] : [0, 0.7, 1.4, 2.1, 2.8, 3.6, 4.5, 5.5, 6.6])
        for (const [dx, dz] of shift ? WAYS : [[1, 0] as const]) {
          const x = ox + dx * shift, z = oz + dz * shift;
          if (!robot && (inCrack(x, z, -0.5) || (k === "lantern" && walkAt(x, z) > 4.3))) continue;
          for (const w of robot ? [base + shift, base + shift + 0.6] : [1, 0.75, 0.55, 0.4]) tries.push([x, z, w]);
        }
      let best: { depth: number; at: [number, number, number] } = { depth: Infinity, at: [ox, oz, base] };
      if (robot) {
        // Round its robot there is nearly always a trunk: the circle with the widest clear stretch (all of it if it
        // can), which it then swings along.
        let arc = { mid: 0, half: -1 };
        for (const t of tries) {
          const rr = orbitRadius(t[2], out.rand[c + 3]);
          const a = clearArc(t[0], t[1], rr, around.filter((s) => Math.abs(Math.hypot(s.x - t[0], s.z - t[1]) - rr) < s.r + 0.2));
          if (a.half > arc.half + 0.05) {
            arc = a;
            best = { depth: 0, at: t };
          }
          if (a.half >= 1.4) break;
        }
        out.arc.set([arc.mid, Math.max(0, arc.half)], i * 2);
        prepare(i);
      } else {
        // The first clear try (each dropped at its first touch); failing that, the least deep of the nearest.
        const attempt = ([x, z, w]: [number, number, number], enough: number) =>
          depthIn(i, x, z, w, around.filter((s) => Math.hypot(s.x - x, s.z - z) - s.r < 2.6 * w + 0.3), enough);
        for (const t of tries)
          if (attempt(t, 0) <= 0) {
            best = { depth: 0, at: t };
            break;
          }
        if (best.depth > 0)
          for (const t of tries.slice(0, 36)) {
            const depth = attempt(t, best.depth);
            if (depth < best.depth) best = { depth, at: t };
          }
      }
      const [x, z, w] = best.at;
      if (robot) out.center.set([x, F, z, w], c);
      else {
        out.position[q] = x;
        out.position[q + 2] = z;
        out.center[c + 3] = w;
      }

      // The solids it keeps out of: those its path comes nearest, first by its free path, then again by where
      // settling really takes it (a push off one trunk can carry it toward another).
      for (let n = 0, rr = orbitRadius(w, out.rand[c + 3]); n < N; n++) at(i, n, x, z, w, rr);
      const near = around.filter((s) => Math.hypot(s.x - x, s.z - z) - s.r < (robot ? orbitRadius(w, out.rand[c + 3]) : 2.6 * w) + 1.5);
      if (mine) near.push(mine);
      for (let round = 0; round < 2; round++) {
        const closest = near.map(() => Infinity);
        for (let n = 0; n < N; n++) {
          const p = round === 0 ? [pts[n * 3], pts[n * 3 + 1], pts[n * 3 + 2]] : settle([pts[n * 3], pts[n * 3 + 1], pts[n * 3 + 2]], own);
          near.forEach((s, j) => {
            if (p[1] < s.top) closest[j] = Math.min(closest[j], Math.hypot(p[0] - s.x, p[2] - s.z) - s.r);
          });
        }
        const ranked = near.map((s, j) => [s, closest[j]] as const).sort((a, b) => a[1] - b[1]);
        // The second round keeps the first's that the free path comes near, and adds what settling runs into.
        const first = round === 0 ? [] : own.filter((s) => ranked.find(([o]) => o === s)![1] < 0.5);
        // At most two pieces of any one log, so a log doesn't crowd out the trunks round it.
        const perLog = new Map<number, number>();
        own = [...first, ...ranked.map(([s]) => s).filter((s) => !first.includes(s))]
          .filter((s) => s.log === undefined || (perLog.set(s.log, (perLog.get(s.log) ?? 0) + 1).get(s.log) ?? 0) <= 2)
          .slice(0, SOLIDS_EACH);
      }
    }
    for (let j = 0; j < SOLIDS_EACH; j++) {
      const s = own[j] ?? NONE;
      out.solids[j].set([s.x, s.z, s.r, s.top], i * 4);
    }
  });
  return out;
}
