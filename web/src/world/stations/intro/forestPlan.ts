// The forest floor's layout, pure and seeded so every visit is the same and the tests can hold it to
// the camera's way (path.ts walkXZ): the crack's jagged lens (mirrored in the ground's shader,
// placeShaders.ts), the trunks (clear of the walk, the crack and each other, crowding round the
// clearing), the robot parts half buried in the moss beside the walk, and the light shafts falling
// through the gaps. Forest.tsx turns them into geometry.
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

export interface Tree {
  x: number;
  z: number;
  /** The trunk's radius at chest height (it flares toward the roots). */
  radius: number;
  height: number;
  /** A small lean (radians) about x and z. */
  lean: [number, number];
}

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
    if (Math.hypot(x - cx, z - cz) > FOREST.radius - 1) continue;
    if (near(walk, x, z) <= radius + 1.7) continue;
    if (inCrack(x, z, -2.6)) continue;
    if (out.some((t) => Math.hypot(t.x - x, t.z - z) <= t.radius + radius + 0.6)) continue;
    out.push({ x, z, radius, height, lean });
  }
  return out;
}

/** The robot's meshes (web/public/robots/franka_description/meshes/collision/*.stl). */
export const PART_KINDS = ["link0", "link1", "link2", "link3", "link4", "link5", "link6", "link7", "hand", "finger"] as const;
export type PartKind = (typeof PART_KINDS)[number];

/** How many of each lie in the moss. */
const COUNT: Partial<Record<PartKind, number>> = { hand: 3, finger: 4, link1: 2, link3: 2, link4: 2, link6: 2, link7: 2 };

export interface Part {
  kind: PartKind;
  x: number;
  z: number;
  /** How much of its height is under the moss (0–1). */
  sink: number;
  /** Euler angles (radians). */
  rot: [number, number, number];
  /** World metres per mesh metre: the parts lie bigger than life, like ruins. */
  scale: number;
}

/** The parts, beside the walk where the camera passes them, never in the crack or a trunk. */
export function parts(seed: number, walk: readonly XZ[], forest: readonly Tree[]): Part[] {
  const rnd = seeded(seed);
  const out: Part[] = [];
  // The walk's ground half: where the camera is down among the trunks, not the canopy above them.
  const ground = walk.slice(Math.floor(walk.length * 0.35));
  for (const kind of PART_KINDS) {
    const want = COUNT[kind] ?? 1;
    for (let k = 0, tries = 0; k < want && tries < 4000; tries++) {
      const [wx, wz] = ground[Math.floor(rnd() * ground.length)];
      const a = rnd() * Math.PI * 2;
      // Most close enough to pass by, a few further off in the mist.
      const d = 2.2 + rnd() ** 1.6 * 7;
      const x = wx + Math.cos(a) * d;
      const z = wz + Math.sin(a) * d;
      const w = near(walk, x, z);
      if (w <= 1.8 || w >= 11) continue;
      if (inCrack(x, z, -1)) continue;
      if (forest.some((t) => Math.hypot(t.x - x, t.z - z) <= t.radius + 0.9)) continue;
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 1.6)) continue;
      out.push({ kind, x, z, sink: 0.25 + rnd() * 0.35, rot: [rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2], scale: 3.4 + rnd() * 1.6 });
      k++;
    }
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
