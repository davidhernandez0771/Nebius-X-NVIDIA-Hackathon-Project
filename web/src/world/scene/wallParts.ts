// The robot wall's meshes (wallPlan.ts says what stands where). The robots are their makers' published
// meshes (robotModels.ts), all at one scale so their real sizes show against each other; the parts are
// pieces of the same meshes, enlarged as specimens on a foot and a rod; the Flexiv, which has no open
// meshes, is a simple stand-in. Everything is coloured per vertex and merged into ONE geometry for the
// whole wall, so both walls cost a single draw call (the library they replaced cost two). Each vertex
// carries `aSpot`: the picture light over its item (xyz, under the board above) and the item's number in
// w (1–5 for the catalog robots, 0 for the rest), which RobotWall's shader uses for the museum light and
// the highlight. A second, additive geometry is the glow each light throws on the wall behind its item.
//
// Local frame of an item: origin on the board at the item's centre, +y up, +x out into the room, z
// along the wall. Each builder stays inside its kind's footprint (ITEM_SIZE).
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CATALOG } from "../stations/robots/catalog";
import { MODEL_IDS, modelPieces } from "./robotModels";
import { ITEM_SIZE, itemBase, type ItemKind, type WallItem } from "./wallPlan";

const C = {
  paint: new THREE.Color("#d9d5cc"),
  dark: new THREE.Color("#15191b"),
  graphite: new THREE.Color("#2b3034"),
  metal: new THREE.Color("#8d9399"),
  teal: new THREE.Color("#19f5c2"),
  plinth: new THREE.Color("#0e1113"),
  card: new THREE.Color("#cfcabd"),
};

const PLINTH_H = 0.16;
/** The picture light hangs under the board above, this far up from the item's board and out from its centre. */
const SPOT_UP = 2.95;
const SPOT_OUT = 1.3;

/**
 * Every robot's model is scaled by this (the room is built large: its shelves are 3.2 m apart), so the
 * UR5e (0.81 m) stands about 2.07 m and the SO-101 (0.21 m) about 0.53 m: their real sizes, side by side.
 * The largest that fits every model in the robot footprint at YAW (tested).
 */
export const ROBOT_SCALE = 2.55;
/** The arm reaches along the wall, turned 20° out toward the room (a turn of 70° about y from +x). */
const YAW = (70 * Math.PI) / 180;
/** The parts are enlarged specimens: this much bigger than the robots, or as big as their footprint allows. */
const PART_SCALE = ROBOT_SCALE * 1.8;
/** A piece heavier than this stays off the shelves (the xArm's fused base is 8,800 triangles); the low tier's limit is lower. */
export const PART_MAX_TRIS = 3000;
export const PART_MAX_TRIS_LOW = 1000;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);

/** Pieces in one frame, merged into one indexed geometry with a colour per vertex. */
class Kit {
  private geos: THREE.BufferGeometry[] = [];
  constructor(private seg = 14) {}

  /** Adds a piece in one colour (null: a piece that already has its colours). */
  add(geo: THREE.BufferGeometry, color: THREE.Color | null, at: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], quat?: THREE.Quaternion): this {
    const g = geo.index ? geo : mergeVertices(geo);
    const keep = color === null ? g.getAttribute("color") : null;
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    g.applyMatrix4(_m.compose(new THREE.Vector3(...at), quat ?? _q.setFromEuler(_e.set(...rot)), new THREE.Vector3(1, 1, 1)));
    if (keep) g.setAttribute("color", keep);
    else {
      const n = g.getAttribute("position").count;
      const c = new Float32Array(n * 3);
      const k = color ?? C.paint;
      for (let i = 0; i < n; i++) c.set([k.r, k.g, k.b], i * 3);
      g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    }
    this.geos.push(g);
    return this;
  }
  cyl(r: number, h: number, color: THREE.Color, at: [number, number, number], rot?: [number, number, number]): this {
    return this.add(new THREE.CylinderGeometry(r, r, h, this.seg), color, at, rot);
  }
  box(w: number, h: number, d: number, color: THREE.Color, at: [number, number, number], rot?: [number, number, number]): this {
    // Box sizes are given as (along z, up, into the room x), the way the wall reads.
    return this.add(new THREE.BoxGeometry(d, h, w), color, at, rot);
  }
  /** A link from a to b (points in the item's z–y profile plane), with a joint cap at a. */
  bar(a: [number, number], b: [number, number], r: number, color: THREE.Color, cap: THREE.Color | null, capR = r * 1.3): this {
    const d = new THREE.Vector3(0, b[1] - a[1], b[0] - a[0]);
    const len = d.length();
    this.add(new THREE.CylinderGeometry(r, r, len, this.seg), color, [0, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2], undefined, new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
    if (cap) this.cyl(capR, capR * 1.6, cap, [0, a[1], a[0]], [0, 0, Math.PI / 2]);
    return this;
  }
  geometry(): THREE.BufferGeometry {
    const g = mergeGeometries(this.geos);
    if (!g) throw new Error("world: the wall's pieces don't merge");
    this.geos.forEach((x) => x.dispose());
    this.geos = [];
    return g;
  }
}

/** Moves a geometry to stand on y = 0, centred in x and z. */
function centre(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.computeBoundingBox();
  return g;
}

/** Scales and moves a geometry into a footprint: standing on y = 0, centred in x and z. */
function fit(g: THREE.BufferGeometry, kind: ItemKind, margin = 1): THREE.BufferGeometry {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const s = ITEM_SIZE[kind];
  const k = margin * Math.min(s.height / (b.max.y - b.min.y), s.depth / (b.max.x - b.min.x), s.width / (b.max.z - b.min.z));
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.scale(k, k, k);
  g.computeBoundingBox();
  return g;
}

/** A robot's model on the wall: turned to reach along it (out toward the room), at ROBOT_SCALE, centred. */
export function robotGeometry(model: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = model.clone();
  g.rotateY(YAW);
  g.scale(ROBOT_SCALE, ROBOT_SCALE, ROBOT_SCALE);
  return centre(g);
}

/** One real piece on display: on a dark foot and a thin rod, enlarged as far as its footprint allows. */
export function partGeometry(piece: THREE.BufferGeometry, kind: Exclude<ItemKind, "robot">): THREE.BufferGeometry {
  const s = ITEM_SIZE[kind];
  const foot = 0.04;
  const rod = kind === "part-lg" ? 0.42 : 0.3;
  const g = piece.clone();
  g.computeBoundingBox();
  const size = g.boundingBox!.getSize(new THREE.Vector3());
  const k = Math.min(PART_SCALE, (0.94 * (s.height - foot - rod)) / size.y, (0.92 * s.depth) / size.x, (0.92 * s.width) / size.z);
  g.scale(k, k, k);
  centre(g).translate(0, foot + rod, 0);
  const kit = new Kit(12);
  kit.cyl(Math.min(0.26, s.depth * 0.3), foot, C.dark, [0, foot / 2, 0]);
  kit.cyl(0.025, rod, C.metal, [0, foot + rod / 2, 0]);
  kit.add(g, null);
  return kit.geometry();
}

/** A gripper pointing down from (0, 0, 0) in the profile plane: style 0 parallel jaws, 1 adaptive (Grav-like), 2 a single jaw. */
function gripperOn(kit: Kit, style: number, s: number, at: [number, number], tilt = 0): void {
  // Build it pointing down from the mount, then turn it by `tilt` about x (the profile's normal).
  const parts = new Kit();
  parts.cyl(0.12 * s, 0.05 * s, C.dark, [0, -0.025 * s, 0]);
  if (style === 0) {
    parts.box(0.26 * s, 0.14 * s, 0.14 * s, C.paint, [0, -0.12 * s, 0]);
    for (const k of [-1, 1]) parts.box(0.04 * s, 0.2 * s, 0.07 * s, C.dark, [0, -0.29 * s, k * 0.07 * s]);
  } else if (style === 1) {
    parts.cyl(0.11 * s, 0.14 * s, C.paint, [0, -0.12 * s, 0]);
    for (const k of [-1, 1]) {
      parts.box(0.04 * s, 0.18 * s, 0.07 * s, C.metal, [0, -0.27 * s, k * 0.08 * s], [k * 0.35, 0, 0]);
      parts.box(0.035 * s, 0.14 * s, 0.065 * s, C.dark, [0, -0.41 * s, k * 0.1 * s], [-k * 0.25, 0, 0]);
    }
  } else {
    parts.box(0.16 * s, 0.12 * s, 0.12 * s, C.dark, [0, -0.11 * s, 0]);
    parts.box(0.035 * s, 0.22 * s, 0.06 * s, C.paint, [0, -0.28 * s, -0.04 * s]);
    parts.box(0.035 * s, 0.18 * s, 0.06 * s, C.paint, [0, -0.26 * s, 0.05 * s], [0.3, 0, 0]);
  }
  const g = parts.geometry();
  g.rotateX(tilt);
  g.translate(0, at[1], at[0]);
  kit.add(g, null);
}

/**
 * The catalog robot with no open meshes, as a simple stand-in in profile (z along the wall, y up): its
 * joint chain, link radius, colours and gripper. The shape only suggests the arm; it isn't its real
 * geometry or size (the catalog panel says so).
 */
interface StandIn {
  base: { r: number; h: number; block?: boolean };
  points: [number, number][];
  r: number;
  link: THREE.Color;
  joint: THREE.Color;
  gripper: 0 | 1 | 2;
}

export const STAND_INS: Record<string, StandIn> = {
  flexiv: { base: { r: 0.09, h: 0.1 }, points: [[0, 0.1], [0, 0.36], [0.2, 0.62], [0.43, 0.5], [0.5, 0.36]], r: 0.04, link: C.paint, joint: C.graphite, gripper: 1 },
};

export function standIn(id: string): THREE.BufferGeometry {
  const s = STAND_INS[id];
  if (!s) throw new Error(`world: no stand-in for "${id}"`);
  const kit = new Kit(16);
  if (s.base.block) kit.box(s.base.r * 2.4, s.base.h, s.base.r * 2.4, s.joint, [0, s.base.h / 2, 0]);
  else kit.cyl(s.base.r, s.base.h, s.joint, [0, s.base.h / 2, 0]);
  kit.cyl(s.base.r * 1.02, s.base.h * 0.12, C.teal, [0, s.base.h * 0.9, 0]);
  for (let i = 0; i < s.points.length - 1; i++) kit.bar(s.points[i], s.points[i + 1], s.r, s.link, s.joint);
  const end = s.points[s.points.length - 1];
  const prev = s.points[s.points.length - 2];
  kit.cyl(s.r * 1.3, s.r * 2, s.joint, [0, end[1], end[0]], [0, 0, Math.PI / 2]);
  // The gripper follows the last link's direction (pointing down and out).
  const tilt = Math.atan2(end[0] - prev[0], -(end[1] - prev[1]));
  gripperOn(kit, s.gripper, s.r * 3.2, end, -tilt);
  return fit(kit.geometry(), "robot", 0.8);
}

/** The loaded models, ready for the wall: each robot as it stands, and the parts' pieces, mixed across robots. */
export interface WallModels {
  robots: Partial<Record<string, THREE.BufferGeometry>>;
  pieces: THREE.BufferGeometry[];
  /** Which robot each piece comes from. */
  sources: string[];
}

const triCount = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

export function wallModels(models: Partial<Record<string, THREE.BufferGeometry>>, maxTris = PART_MAX_TRIS): WallModels {
  const robots: WallModels["robots"] = {};
  const lists: [string, THREE.BufferGeometry[]][] = [];
  for (const id of MODEL_IDS) {
    const m = models[id];
    if (!m) continue;
    robots[id] = robotGeometry(m);
    lists.push([id, modelPieces(m).filter((p) => triCount(p) <= maxTris)]);
  }
  // Rank by rank, so neighbours on a shelf come from different robots.
  const pieces: THREE.BufferGeometry[] = [];
  const sources: string[] = [];
  for (let rank = 0; lists.some(([, l]) => rank < l.length); rank++)
    for (const [id, l] of lists)
      if (rank < l.length) {
        pieces.push(l[rank]);
        sources.push(id);
      }
  return { robots, pieces, sources };
}

/** The picture light over an item: under the board above it, out toward the room. */
function spotFor(it: WallItem): THREE.Vector3 {
  const [x, y, z] = itemBase(it);
  return new THREE.Vector3(x - it.side * SPOT_OUT, y + SPOT_UP, z);
}

/** An item's local geometry (null: its model isn't in, or didn't load). */
function itemGeometry(it: WallItem, models: WallModels | null): THREE.BufferGeometry | null {
  if (it.kind === "robot") {
    const m = models?.robots[it.robot!];
    if (m) return m.clone();
    return STAND_INS[it.robot!] ? standIn(it.robot!) : null;
  }
  if (!models?.pieces.length) return null;
  return partGeometry(models.pieces[it.variant % models.pieces.length], it.kind);
}

/** Gives every vertex its item's picture light and number (aSpot). */
function withSpot(g: THREE.BufferGeometry, it: WallItem, n: number): THREE.BufferGeometry {
  const spot = spotFor(it);
  const count = g.getAttribute("position").count;
  const a = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) a.set([spot.x, spot.y, spot.z, n], i * 4);
  g.setAttribute("aSpot", new THREE.BufferAttribute(a, 4));
  return g;
}

/** The whole wall, in world coordinates, as one geometry: position, normal, color and aSpot. */
export function buildWall(plan: readonly WallItem[], models: WallModels | null): THREE.BufferGeometry {
  const ids = CATALOG.map((r) => r.id);
  const all: THREE.BufferGeometry[] = [];
  for (const it of plan) {
    const size = ITEM_SIZE[it.kind];
    const kit = new Kit(10);
    kit.box(size.width * 0.86, PLINTH_H, size.depth * 0.95, C.plinth, [0, PLINTH_H / 2, 0]);
    // The museum card on the board's front edge, tilted up to the room.
    kit.box(Math.min(0.55, size.width * 0.4), 0.03, 0.22, C.card, [0.72, 0.06, size.width * 0.18], [0, 0, -0.5]);
    const stand = kit.geometry();
    const g = itemGeometry(it, models)?.translate(0, PLINTH_H, 0) ?? null;
    // The plinth and the card keep number 0, and so do the extras: only a catalog robot lights up.
    const n = it.robot && !it.extra ? ids.indexOf(it.robot) + 1 : 0;
    const item = g ? mergeGeometries([withSpot(stand, it, 0), withSpot(g, it, n)])! : withSpot(stand, it, 0);
    // Face the room: the left wall's room is +x (as built), the right wall's is -x.
    if (it.side === 1) item.rotateY(Math.PI);
    const [x, y, z] = itemBase(it);
    item.translate(x, y, z);
    all.push(item);
  }
  const g = mergeGeometries(all);
  if (!g) throw new Error("world: the wall doesn't merge");
  all.forEach((x) => x.dispose());
  g.computeBoundingSphere();
  return g;
}

/** The light each picture light throws on the wall behind its item: one quad per item, uv 0–1. */
export function buildPools(plan: readonly WallItem[]): THREE.BufferGeometry {
  const quads: THREE.BufferGeometry[] = [];
  for (const it of plan) {
    const size = ITEM_SIZE[it.kind];
    const q = new THREE.PlaneGeometry(size.width * 1.7, Math.min(3.0, size.height * 1.35));
    q.rotateY(-it.side * (Math.PI / 2));
    const [, y, z] = itemBase(it);
    q.translate(it.side * 21.95, y + Math.min(3.0, size.height * 1.35) / 2 - 0.05, z);
    quads.push(q);
  }
  const g = mergeGeometries(quads);
  if (!g) throw new Error("world: the pools don't merge");
  return g;
}
