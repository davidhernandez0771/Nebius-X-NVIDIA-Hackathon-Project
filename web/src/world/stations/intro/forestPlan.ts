// The forest floor's layout, pure and seeded so every visit is the same and the tests can hold it to
// the camera's way (path.ts walkXZ): the crack's jagged lens (mirrored in the ground's shader,
// placeShaders.ts), the trunks in three depth layers (near / mid / far, each drawn at its own detail) plus
// a far ring beyond the forest, the roots spreading from the near and mid trunks, fallen logs, ferns and
// moss at the trunks' feet, the mist bands, the light shafts falling through the gaps, and the spores.
// Everything stays clear of the walk and the crack. The robots lying in the moss are forestRobots.ts.
// Forest.tsx and forestGeometry.ts turn them into geometry.
import { CRACK, FOREST } from "./layout";
import { seeded } from "./particles";

type XZ = readonly [number, number];

const DIR: XZ = [Math.cos(CRACK.angle), -Math.sin(CRACK.angle)];
const ACROSS: XZ = [Math.sin(CRACK.angle), Math.cos(CRACK.angle)];

/** A ground point in the crack's own frame: u along it, v across it, from its centre. */
export function crackLocal(x: number, z: number): [number, number] {
  const dx = x - CRACK.center[0];
  const dz = z - CRACK.center[1];
  return [dx * DIR[0] + dz * DIR[1], dx * ACROSS[0] + dz * ACROSS[1]];
}

/** The crack's half width at u along it: a lens closed at both ends, with a broken edge. Mirrored in GLSL. */
export function crackHalfWidth(u: number): number {
  const L = CRACK.halfLength;
  if (Math.abs(u) >= L) return 0;
  const jag = 1 + 0.16 * Math.sin(2.3 * u + 1.1) + 0.09 * Math.sin(5.7 * u + 0.4);
  return CRACK.halfWidth * Math.sqrt(1 - (u / L) ** 2) * jag;
}

/**
 * Whether a ground point is in the crack, `margin` metres inside its edge. A negative margin asks
 * whether it is within that distance of the crack instead (round its ends too).
 */
export function inCrack(x: number, z: number, margin = 0): boolean {
  const [u, v] = crackLocal(x, z);
  if (margin >= 0) return Math.abs(v) < crackHalfWidth(u) - margin;
  const L = CRACK.halfLength;
  if (Math.abs(u) >= L - margin) return false;
  const uc = Math.max(-L * 0.98, Math.min(L * 0.98, u));
  return Math.abs(v) < crackHalfWidth(uc) - margin;
}

const near = (walk: readonly XZ[], x: number, z: number) => Math.min(...walk.map(([a, b]) => Math.hypot(a - x, b - z)));

/** Near (0): framing the walk, full detail. Mid (1). Far (2): silhouettes in the mist, the cheapest mesh. */
export type Layer = 0 | 1 | 2;

export interface Tree {
  x: number;
  z: number;
  /** The trunk's radius at chest height (it flares toward the roots). */
  radius: number;
  height: number;
  /** A small lean (radians) about x and z. */
  lean: [number, number];
  layer: Layer;
  /** 0-1: the bark's own shade and grain, so no two trunks look alike. */
  tint: number;
}

/** A trunk's layer, by how far it stands from the camera's way. */
export const layerOf = (distanceToWalk: number): Layer => (distanceToWalk < 9 ? 0 : distanceToWalk < 22 ? 1 : 2);

/** n trunks: about half crowding the walk, the rest through the whole forest. */
export function trees(n: number, seed: number, walk: readonly XZ[]): Tree[] {
  const rnd = seeded(seed);
  const out: Tree[] = [];
  const [cx, cz] = FOREST.center;
  for (let tries = 0; out.length < n && tries < n * 400; tries++) {
    const radius = 0.32 + rnd() ** 2 * 0.8;
    let x: number;
    let z: number;
    if (rnd() < 0.45) {
      const [wx, wz] = walk[Math.floor(rnd() * walk.length)];
      const a = rnd() * Math.PI * 2;
      const d = radius + 2 + rnd() * 7;
      x = wx + Math.cos(a) * d;
      z = wz + Math.sin(a) * d;
    } else {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * (FOREST.radius - 1.5);
      x = cx + Math.cos(a) * d;
      z = cz + Math.sin(a) * d;
    }
    const height = FOREST.canopy * (0.85 + rnd() * 0.3);
    const lean: [number, number] = [(rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.08];
    const tint = rnd();
    if (Math.hypot(x - cx, z - cz) > FOREST.radius - 1) continue;
    const w = near(walk, x, z);
    if (w <= radius + 1.7) continue;
    if (inCrack(x, z, -2.6)) continue;
    if (out.some((t) => Math.hypot(t.x - x, t.z - z) <= t.radius + radius + 0.6)) continue;
    out.push({ x, z, radius, height, lean, layer: layerOf(w), tint });
  }
  return out;
}

export interface Shaft {
  x: number;
  z: number;
  /** The shaft's radius where it meets the floor. */
  radius: number;
}

/** n shafts of light, near the walk, falling in the gaps between the trunks. */
export function shafts(seed: number, walk: readonly XZ[], forest: readonly Tree[], n: number): Shaft[] {
  const rnd = seeded(seed);
  const out: Shaft[] = [];
  const ground = walk.slice(Math.floor(walk.length * 0.3));
  for (let tries = 0; out.length < n && tries < 6000; tries++) {
    const [wx, wz] = ground[Math.floor(rnd() * ground.length)];
    const a = rnd() * Math.PI * 2;
    const d = 3 + rnd() * 10;
    const x = wx + Math.cos(a) * d;
    const z = wz + Math.sin(a) * d;
    const radius = 1.1 + rnd() * 1.3;
    const w = near(walk, x, z);
    if (w <= 2 || w >= 16) continue;
    if (forest.some((t) => Math.hypot(t.x - x, t.z - z) <= t.radius + radius * 0.5)) continue;
    if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 3.5)) continue;
    out.push({ x, z, radius });
  }
  return out;
}

/** n far trunks in a ring beyond the forest (to FOREST.radius + 30 m): depth in the mist, the far layer's mesh. */
export function farTrees(n: number, seed: number): Tree[] {
  const rnd = seeded(seed);
  const out: Tree[] = [];
  const [cx, cz] = FOREST.center;
  for (let tries = 0; out.length < n && tries < n * 200; tries++) {
    const a = rnd() * Math.PI * 2;
    const d = FOREST.radius + rnd() * 30;
    const radius = 0.4 + rnd() * 0.8;
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    const height = FOREST.canopy * (0.9 + rnd() * 0.3);
    const lean: [number, number] = [(rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.06];
    const tint = rnd();
    if (out.some((t) => Math.hypot(t.x - x, t.z - z) <= t.radius + radius + 1.2)) continue;
    out.push({ x, z, radius, height, lean, layer: 2, tint });
  }
  return out;
}

export interface Root {
  /** Index of the trunk it spreads from (in the trees() list). */
  tree: number;
  /** Direction out from the trunk (radians, from +x toward +z). */
  angle: number;
  /** How far it reaches beyond the trunk's surface (m). */
  length: number;
  /** Its thickness where it leaves the trunk (m). */
  thick: number;
}

/** 3-6 roots from each near and mid trunk, spread round it; none reaches the walk or the crack. */
export function roots(forest: readonly Tree[], seed: number, walk: readonly XZ[]): Root[] {
  const rnd = seeded(seed);
  const out: Root[] = [];
  forest.forEach((t, tree) => {
    if (t.layer === 2) return;
    const k = 3 + Math.floor(rnd() * 4);
    const turn = rnd() * Math.PI * 2;
    for (let i = 0; i < k; i++) {
      const angle = turn + (i / k) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const length = t.radius * (1.4 + rnd() * 2.2) + 0.3;
      const thick = t.radius * (0.15 + rnd() * 0.2);
      const tipX = t.x + Math.cos(angle) * (t.radius + length);
      const tipZ = t.z + Math.sin(angle) * (t.radius + length);
      if (near(walk, tipX, tipZ) <= 0.9 || inCrack(tipX, tipZ, -0.5)) continue;
      out.push({ tree, angle, length, thick });
    }
  });
  return out;
}

export interface Log {
  x: number;
  z: number;
  /** Its axis's direction on the ground (radians, from +x toward +z). */
  yaw: number;
  length: number;
  radius: number;
  /** How much of its diameter is sunk in the moss (0-1). */
  sink: number;
}

/** Distance from a ground point to a log's axis. */
export function toLog(l: Log, x: number, z: number): number {
  const dx = Math.cos(l.yaw) * (l.length / 2);
  const dz = Math.sin(l.yaw) * (l.length / 2);
  const ax = l.x - dx, az = l.z - dz;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx * 2 + (z - az) * dz * 2) / (l.length * l.length)));
  return Math.hypot(x - (ax + dx * 2 * t), z - (az + dz * 2 * t));
}

/** n fallen logs beside the walk (within 14 m), clear of it, the crack, the trunks and each other. */
export function logs(seed: number, walk: readonly XZ[], forest: readonly Tree[], n: number): Log[] {
  const rnd = seeded(seed);
  const out: Log[] = [];
  const ground = walk.slice(Math.floor(walk.length * 0.35));
  for (let tries = 0; out.length < n && tries < 20000; tries++) {
    const [wx, wz] = ground[Math.floor(rnd() * ground.length)];
    const a = rnd() * Math.PI * 2;
    const d = 3 + rnd() * 9;
    const l: Log = { x: wx + Math.cos(a) * d, z: wz + Math.sin(a) * d, yaw: rnd() * Math.PI, length: 4 + rnd() * 5,
                     radius: 0.3 + rnd() * 0.3, sink: 0.2 + rnd() * 0.2 };
    let ok = near(walk, l.x, l.z) < 14;
    for (let k = 0; ok && k <= 10; k++) {
      const u = k / 10 - 0.5;
      const x = l.x + Math.cos(l.yaw) * l.length * u;
      const z = l.z + Math.sin(l.yaw) * l.length * u;
      if (near(walk, x, z) <= l.radius + 1.2 || inCrack(x, z, -1)) ok = false;
      if (out.some((o) => toLog(o, x, z) < o.radius + l.radius + 0.4)) ok = false;
    }
    if (!ok || forest.some((t) => toLog(l, t.x, t.z) <= t.radius + l.radius + 0.2)) continue;
    out.push(l);
  }
  return out;
}

export interface Fern {
  x: number;
  z: number;
  yaw: number;
  /** World metres per fern-mesh metre (the mesh is about a metre across). */
  scale: number;
}

/** n ferns in clusters at the near and mid trunks' feet and along the logs, off the walk and the crack. */
export function ferns(seed: number, walk: readonly XZ[], forest: readonly Tree[], fallen: readonly Log[], n: number): Fern[] {
  const rnd = seeded(seed);
  const out: Fern[] = [];
  const anchors = forest.filter((t) => t.layer < 2);
  for (let tries = 0; out.length < n && tries < n * 300; tries++) {
    let x: number;
    let z: number;
    if (fallen.length && rnd() < 0.25) {
      const l = fallen[Math.floor(rnd() * fallen.length)];
      const u = rnd() - 0.5;
      const side = (rnd() < 0.5 ? -1 : 1) * (l.radius + 0.3 + rnd() * 1.4);
      x = l.x + Math.cos(l.yaw) * l.length * u - Math.sin(l.yaw) * side;
      z = l.z + Math.sin(l.yaw) * l.length * u + Math.cos(l.yaw) * side;
    } else {
      const t = anchors[Math.floor(rnd() * anchors.length)];
      const a = rnd() * Math.PI * 2;
      const d = t.radius + 0.25 + rnd() ** 1.5 * 2.5;
      x = t.x + Math.cos(a) * d;
      z = t.z + Math.sin(a) * d;
    }
    if (near(walk, x, z) <= 0.9 || inCrack(x, z, -0.6)) continue;
    if (forest.some((t) => Math.hypot(t.x - x, t.z - z) <= t.radius + 0.1)) continue;
    if (fallen.some((l) => toLog(l, x, z) <= l.radius * 0.8)) continue;
    out.push({ x, z, yaw: rnd() * Math.PI * 2, scale: 0.7 + rnd() * 0.9 });
  }
  return out;
}

export interface Moss {
  x: number;
  z: number;
  /** The mound's radius (m). */
  r: number;
}

/** n moss mounds round the trunks' feet and the logs, off the walk and the crack. */
export function mossMounds(seed: number, walk: readonly XZ[], forest: readonly Tree[], fallen: readonly Log[], n: number): Moss[] {
  const rnd = seeded(seed);
  const out: Moss[] = [];
  const anchors = forest.filter((t) => t.layer < 2);
  for (let tries = 0; out.length < n && tries < n * 300; tries++) {
    const r = 0.3 + rnd() * 0.6;
    let x: number;
    let z: number;
    if (fallen.length && rnd() < 0.2) {
      const l = fallen[Math.floor(rnd() * fallen.length)];
      const u = rnd() - 0.5;
      x = l.x + Math.cos(l.yaw) * l.length * u;
      z = l.z + Math.sin(l.yaw) * l.length * u;
    } else {
      const t = anchors[Math.floor(rnd() * anchors.length)];
      const a = rnd() * Math.PI * 2;
      const d = t.radius + rnd() * 1.6;
      x = t.x + Math.cos(a) * d;
      z = t.z + Math.sin(a) * d;
    }
    if (near(walk, x, z) <= r * 0.5 + 0.3 || inCrack(x, z, -0.4)) continue;
    out.push({ x, z, r });
  }
  return out;
}

/** The mist: three bands (height y over the floor and thickness in m), each drifting at its own speed (m/s):
 *  one lying on the floor below the walking eye (2.3–2.4 m), two hanging between the trunks above it. */
export const MIST_BANDS = [
  { y: 0.35, thickness: 0.7, speed: 0.012, opacity: 0.5 },
  { y: 4.6, thickness: 0.9, speed: 0.021, opacity: 0.4 },
  { y: 8.2, thickness: 1.8, speed: 0.033, opacity: 0.3 },
] as const;

/** n spores (x, y, z) drifting along the walk: within 13 m of it, from the floor to 11.5 m up. */
export function spores(seed: number, walk: readonly XZ[], n: number): [number, number, number][] {
  const rnd = seeded(seed);
  const ground = walk.slice(Math.floor(walk.length * 0.3));
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [wx, wz] = ground[Math.floor(rnd() * ground.length)];
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 13;
    out.push([wx + Math.cos(a) * d, FOREST.floor + rnd() * 11.5, wz + Math.sin(a) * d]);
  }
  return out;
}
