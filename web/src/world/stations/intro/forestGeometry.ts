// The forest's geometry, pure three.js (no renderer), so its cost per tier is tested: forestPlan.ts's layout built
// into a handful of instanced or merged pieces. Forest.tsx gives each piece its material.
//
// - Trunks in three levels of detail by depth layer (near: buttress roots and fine profile; far: a few sides),
//   instanced, each with its own tint.
// - Roots spreading from the near (and, above low, mid) trunks, logs: merged, one draw each. (The mist
//   bands are drawn by every surface's place(), mistBands.ts: no geometry.)
// - Ferns and moss mounds: one mesh each, instanced.
// - Light shafts from the canopy: crossed quads, merged.
// The layout is computed once at the richest tier's counts; lower tiers take a prefix of each list (the seeded
// samplers make trees(110) a prefix of trees(220)), so every tier and phones show the same places, fewer of them.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TierName } from "../../core/quality";
import {
  farTrees, ferns, logs, mossMounds, roots, shafts, spores, trees,
  type Fern, type Log, type Moss, type Root, type Shaft, type Tree,
} from "./forestPlan";
import { robotSpots, type RobotSpot } from "./forestRobots";
import { FOREST } from "./layout";
import { walkXZ } from "./path";

const F = FOREST.floor;
/** The moon's direction: the shafts lean with it (Forest.tsx lights with it too). */
export const MOON = new THREE.Vector3(-0.45, 1, 0.3).normalize();

export interface ForestTier {
  trees: number;
  far: number;
  ferns: number;
  moss: number;
  logs: number;
  shafts: number;
  spores: number;
  mistBands: number;
  /** Roots spread from trunks up to this layer (0: near only). */
  rootLayer: 0 | 1;
  /** The most draws the pieces may take, and triangles drawn (instances counted). */
  maxDraws: number;
  maxTriangles: number;
}

export const FOREST_TIERS: Record<TierName, ForestTier> = {
  low: { trees: 110, far: 50, ferns: 70, moss: 60, logs: 3, shafts: 6, spores: 160, mistBands: 2, rootLayer: 0, maxDraws: 10, maxTriangles: 60_000 },
  high: { trees: 220, far: 120, ferns: 160, moss: 120, logs: 5, shafts: 12, spores: 500, mistBands: 3, rootLayer: 1, maxDraws: 10, maxTriangles: 160_000 },
  ultra: { trees: 220, far: 160, ferns: 250, moss: 180, logs: 5, shafts: 12, spores: 500, mistBands: 3, rootLayer: 1, maxDraws: 10, maxTriangles: 190_000 },
};

export interface ForestLayout {
  trees: Tree[];
  far: Tree[];
  roots: Root[];
  logs: Log[];
  ferns: Fern[];
  moss: Moss[];
  shafts: Shaft[];
  spores: [number, number, number][];
  robots: RobotSpot[];
}

let cached: ForestLayout | null = null;

/** The whole layout at the richest counts (computed once). */
export function forestLayout(): ForestLayout {
  if (cached) return cached;
  const walk = walkXZ();
  const all = trees(220, 7, walk);
  const fallen = logs(11, walk, all, 5);
  cached = {
    trees: all,
    far: farTrees(160, 3),
    roots: roots(all, 5, walk),
    logs: fallen,
    ferns: ferns(13, walk, all, fallen, 260),
    moss: mossMounds(17, walk, all, fallen, 180),
    shafts: shafts(3, walk, all, 12),
    spores: spores(19, walk, 500),
    robots: robotSpots(walk, all, fallen),
  };
  return cached;
}

/** A tube through `points` with a radius at each, `radial` sides: normals out, uv (along 0-1, around 0-1). */
export function tube(points: readonly (readonly number[])[], radii: readonly number[], radial: number): THREE.BufferGeometry {
  const n = points.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = points.map((q) => new THREE.Vector3(q[0], q[1], q[2]));
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  const out = new THREE.Vector3();
  const t = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    t.subVectors(p[Math.min(n - 1, i + 1)], p[Math.max(0, i - 1)]).normalize();
    side.crossVectors(t, Math.abs(t.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    const b = new THREE.Vector3().crossVectors(side, t).normalize();
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      out.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
      pos.push(p[i].x + out.x * radii[i], p[i].y + out.y * radii[i], p[i].z + out.z * radii[i]);
      nor.push(out.x, out.y, out.z);
      uv.push(i / (n - 1), k / radial);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k;
      const c = a + radial + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const LOD = [
  { radial: 16, ys: [-0.01, 0, 0.004, 0.01, 0.018, 0.03, 0.05, 0.08, 0.15, 0.25, 0.4, 0.55, 0.7, 0.85, 1] },
  { radial: 10, ys: [-0.01, 0, 0.01, 0.03, 0.08, 0.2, 0.45, 0.7, 1] },
  { radial: 6, ys: [-0.01, 0, 0.05, 0.3, 0.7, 1] },
] as const;

/** A trunk of height 1 and radius 1 at chest height, flaring into buttress roots, at a level of detail. */
export function trunkGeometry(lod: 0 | 1 | 2): THREE.BufferGeometry {
  const { radial, ys } = LOD[lod];
  const profile = ys.map((y) => new THREE.Vector2(Math.max(0.05, 1 + 1.1 * Math.exp(-Math.max(0, y) / 0.024) - 0.35 * y), y));
  const g = new THREE.LatheGeometry(profile, radial);
  // Buttresses: lobes round the foot, fading up the trunk.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + (0.16 * Math.sin(5 * a + 0.7) + 0.07 * Math.sin(3 * a + 2.1)) * Math.exp(-Math.max(0, y) / 0.03);
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A fern: `fronds` arching leaves round its centre, about a metre across; uv x along the frond, y across it. */
export function fernGeometry(fronds: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const SEG = 10;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + 0.35 * Math.sin(f * 2.3);
    const len = 0.55 + 0.12 * Math.sin(f * 1.7);
    const dir = [Math.cos(a), Math.sin(a)];
    const perp = [-dir[1], dir[0]];
    const base = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const u = s / SEG;
      const r = len * u;
      const y = 0.45 * Math.sin(Math.PI * u * 0.85) * (1 - 0.3 * u) + 0.02;
      const w = 0.13 * Math.sin(Math.PI * Math.min(1, u * 1.08)) + 0.01;
      for (const side of [-1, 1]) {
        pos.push(dir[0] * r + perp[0] * w * side, y, dir[1] * r + perp[1] * w * side);
        nor.push(0, 1, 0);
        uv.push(u, side < 0 ? 0 : 1);
      }
    }
    for (let s = 0; s < SEG; s++) {
      const i = base + s * 2;
      idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A root from trunk `t`: out from the trunk's foot, arching a little, then down into the moss. */
function rootGeometry(t: Tree, r: Root, radial: number): THREE.BufferGeometry {
  const pts: number[][] = [];
  const rad: number[] = [];
  const c = Math.cos(r.angle), s = Math.sin(r.angle);
  for (let i = 0; i <= 5; i++) {
    const u = i / 5;
    const d = t.radius * 0.7 + (t.radius * 0.3 + r.length) * u;
    const y = F + r.thick * (0.9 * (1 - u) ** 1.3 + 0.45 * Math.sin(Math.PI * u)) - 0.04 * u;
    pts.push([t.x + c * d, y, t.z + s * d]);
    rad.push(r.thick * (1 - 0.7 * u ** 1.4) + 0.012);
  }
  return tube(pts, rad, radial);
}

/** A fallen log: a lumpy tube along its yaw, sunk into the moss, with broken ends. */
function logGeometry(l: Log): THREE.BufferGeometry {
  const pts: number[][] = [];
  const rad: number[] = [];
  const cy = F + l.radius * (1 - 2 * l.sink);
  const c = Math.cos(l.yaw), s = Math.sin(l.yaw);
  for (let i = 0; i <= 8; i++) {
    const u = i / 8 - 0.5;
    pts.push([l.x + c * l.length * u, cy + 0.04 * Math.sin(i * 1.9), l.z + s * l.length * u]);
    rad.push(l.radius * (1 + 0.08 * Math.sin(i * 2.7 + l.x)) * (i === 0 || i === 8 ? 0.82 : 1));
  }
  const body = tube(pts, rad, 12);
  // Broken ends: a jagged cone over each end.
  const caps: THREE.BufferGeometry[] = [];
  for (const end of [-1, 1]) {
    const ex = l.x + c * l.length * 0.5 * end, ez = l.z + s * l.length * 0.5 * end;
    const ring: number[][] = [];
    const ringR: number[] = [];
    ring.push([ex, cy, ez]);
    ringR.push(l.radius * 0.8);
    ring.push([ex + c * 0.12 * end, cy, ez + s * 0.12 * end]);
    ringR.push(l.radius * 0.35);
    ring.push([ex + c * 0.2 * end, cy + 0.03, ez + s * 0.2 * end]);
    ringR.push(0.02);
    caps.push(tube(ring, ringR, 12));
  }
  const g = mergeGeometries([body, ...caps], false)!;
  body.dispose();
  caps.forEach((q) => q.dispose());
  return g;
}

/** Shafts of moonlight from the canopy to the floor: two crossed quads each, leaning with the moon. */
export function shaftGeometry(list: readonly Shaft[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const h = FOREST.canopy * 1.15;
  const lean = [MOON.x * h * 0.4, MOON.z * h * 0.4];
  for (const s of list) {
    for (const a of [0.3, 0.3 + Math.PI / 2]) {
      const dx = Math.cos(a), dz = Math.sin(a);
      const b0 = [s.x - dx * s.radius, F, s.z - dz * s.radius];
      const b1 = [s.x + dx * s.radius, F, s.z + dz * s.radius];
      const t0 = [s.x + lean[0] - dx * s.radius * 1.8, F + h, s.z + lean[1] - dz * s.radius * 1.8];
      const t1 = [s.x + lean[0] + dx * s.radius * 1.8, F + h, s.z + lean[1] + dz * s.radius * 1.8];
      pos.push(...b0, ...b1, ...t1, ...b0, ...t1, ...t0);
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export interface ForestPiece {
  name: string;
  geometry: THREE.BufferGeometry;
  /** Instanced: how many, their matrices, and per-instance attributes. */
  instances?: number;
  matrices?: THREE.Matrix4[];
  attributes?: Record<string, Float32Array>;
}

const q = new THREE.Quaternion();
const e = new THREE.Euler();

function trunkMatrix(t: Tree, i: number): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(t.x, F, t.z), q.setFromEuler(e.set(t.lean[0], i * 1.7, t.lean[1])).clone(),
    new THREE.Vector3(t.radius, t.height, t.radius));
}

/** The forest's pieces for a tier, and the (sliced) layout they came from. */
export function buildForest(tier: TierName): { pieces: ForestPiece[]; layout: ForestLayout } {
  const T = FOREST_TIERS[tier];
  const all = forestLayout();
  const layout: ForestLayout = {
    trees: all.trees.slice(0, T.trees),
    far: all.far.slice(0, T.far),
    roots: all.roots.filter((r) => r.tree < T.trees && all.trees[r.tree].layer <= T.rootLayer),
    logs: all.logs.slice(0, T.logs),
    ferns: all.ferns.slice(0, T.ferns),
    moss: all.moss.slice(0, T.moss),
    shafts: all.shafts.slice(0, T.shafts),
    spores: all.spores.slice(0, T.spores),
    robots: all.robots,
  };
  const pieces: ForestPiece[] = [];
  const byLayer: [Tree, number][][] = [[], [], []];
  layout.trees.forEach((t, i) => byLayer[t.layer].push([t, i]));
  layout.far.forEach((t, i) => byLayer[2].push([t, 1000 + i]));
  (["near", "mid", "far"] as const).forEach((name, l) => {
    const list = byLayer[l];
    if (!list.length) return;
    pieces.push({
      name: `trunks:${name}`,
      geometry: trunkGeometry(l as 0 | 1 | 2),
      instances: list.length,
      matrices: list.map(([t, i]) => trunkMatrix(t, i)),
      attributes: { aTint: Float32Array.from(list.map(([t]) => t.tint)) },
    });
  });
  if (layout.roots.length) {
    const parts = layout.roots.map((r) => rootGeometry(layout.trees[r.tree], r, layout.trees[r.tree].layer === 0 ? 7 : 5));
    pieces.push({ name: "roots", geometry: mergeGeometries(parts, false)! });
    parts.forEach((g) => g.dispose());
  }
  if (layout.logs.length) {
    const parts = layout.logs.map(logGeometry);
    pieces.push({ name: "logs", geometry: mergeGeometries(parts, false)! });
    parts.forEach((g) => g.dispose());
  }
  pieces.push({
    name: "ferns",
    geometry: fernGeometry(tier === "low" ? 6 : 8),
    instances: layout.ferns.length,
    matrices: layout.ferns.map((f) => new THREE.Matrix4().compose(new THREE.Vector3(f.x, F, f.z), q.setFromEuler(e.set(0, f.yaw, 0)).clone(),
      new THREE.Vector3(f.scale, f.scale, f.scale))),
  });
  pieces.push({
    name: "moss",
    geometry: new THREE.SphereGeometry(1, tier === "low" ? 8 : 12, tier === "low" ? 4 : 6, 0, Math.PI * 2, 0, Math.PI / 2),
    instances: layout.moss.length,
    matrices: layout.moss.map((m) => new THREE.Matrix4().compose(new THREE.Vector3(m.x, F - 0.03, m.z), q.identity().clone(),
      new THREE.Vector3(m.r, m.r * 0.42, m.r * (0.8 + 0.4 * ((m.x * 7.3) % 1 + 1) % 1)))),
  });
  pieces.push({ name: "shafts", geometry: shaftGeometry(layout.shafts) });
  return { pieces, layout };
}
