// The robot wall's meshes (wallPlan.ts says what stands where). Every piece is a primitive or one of
// the Franka's collision meshes (the STLs the twin already loads), coloured per vertex and merged into
// ONE geometry for the whole wall, so both walls cost a single draw call (the library they replace
// cost two). Each vertex carries `aSpot`: the picture light over its item (xyz, under the board above)
// and the item's number in w (1–5 for the catalog robots, 0 for parts), which RobotWall's shader uses
// for the museum light pools and the highlight. A second, additive geometry is the glow each light
// throws on the wall behind its item.
//
// Local frame of an item: origin on the board at the item's centre, +y up, +x out into the room, z
// along the wall. Each builder is fitted into its kind's footprint (ITEM_SIZE).
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { URDFRobot } from "urdf-loader";
import { FRANKA } from "../../twin/model";
import { CATALOG } from "../stations/robots/catalog";
import { FRANKA_LINKS, ITEM_SIZE, itemBase, type ItemKind, type WallItem } from "./wallPlan";

const C = {
  paint: new THREE.Color("#d9d5cc"),
  dark: new THREE.Color("#15191b"),
  graphite: new THREE.Color("#2b3034"),
  metal: new THREE.Color("#8d9399"),
  teal: new THREE.Color("#19f5c2"),
  amber: new THREE.Color("#e8a33d"),
  plinth: new THREE.Color("#0e1113"),
  card: new THREE.Color("#cfcabd"),
};

const PLINTH_H = 0.16;
/** The picture light hangs under the board above, this far up from the item's board and out from its centre. */
const SPOT_UP = 2.95;
const SPOT_OUT = 1.3;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);

/** Pieces in one frame, merged into one indexed geometry with a colour per vertex. */
class Kit {
  private geos: THREE.BufferGeometry[] = [];
  constructor(private seg = 14) {}

  /** Adds a piece in one colour (null: a piece that already has its colours, from another Kit). */
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

function gripper(variant: number): THREE.BufferGeometry {
  const kit = new Kit();
  kit.cyl(0.3, 0.1, C.dark, [0, 0.05, 0]);
  kit.cyl(0.31, 0.02, C.teal, [0, 0.11, 0]);
  const style = variant % 3;
  const parts = new Kit();
  // Upside down (fingers up), as a gripper stands on display.
  if (style === 0) {
    parts.box(0.55, 0.4, 0.34, C.paint, [0, 0.32, 0]);
    parts.box(0.6, 0.06, 0.2, C.dark, [0, 0.55, 0]);
    for (const k of [-1, 1]) {
      parts.box(0.09, 0.55, 0.16, C.dark, [0, 0.85, k * 0.18]);
      parts.box(0.1, 0.16, 0.17, C.metal, [0, 1.08, k * 0.18]);
    }
  } else if (style === 1) {
    parts.cyl(0.25, 0.3, C.paint, [0, 0.27, 0]);
    for (const k of [-1, 1]) {
      parts.box(0.08, 0.5, 0.16, C.metal, [0, 0.65, k * 0.16], [k * 0.35, 0, 0]);
      parts.box(0.07, 0.42, 0.15, C.dark, [0, 1.05, k * 0.22], [-k * 0.25, 0, 0]);
    }
  } else {
    parts.box(0.4, 0.36, 0.3, C.dark, [0, 0.3, 0]);
    parts.box(0.08, 0.6, 0.14, C.paint, [0, 0.78, -0.1]);
    parts.box(0.08, 0.5, 0.14, C.paint, [0, 0.72, 0.13], [-0.3, 0, 0]);
  }
  kit.add(parts.geometry(), null);
  return fit(kit.geometry(), "gripper", 0.82 + 0.05 * (variant % 2));
}

function wrist(variant: number): THREE.BufferGeometry {
  const kit = new Kit();
  kit.cyl(0.32, 0.1, C.dark, [0, 0.05, 0]);
  kit.cyl(0.26, 0.5, variant % 2 ? C.graphite : C.paint, [0, 0.35, 0]);
  kit.cyl(0.27, 0.025, C.teal, [0, 0.6, 0]);
  kit.cyl(0.22, 0.62, variant % 2 ? C.graphite : C.paint, [0, 0.78, 0], [Math.PI / 2, 0, 0]);
  for (const k of [-1, 1]) kit.cyl(0.23, 0.05, C.dark, [0, 0.78, k * 0.33], [Math.PI / 2, 0, 0]);
  kit.cyl(0.16, 0.12, C.metal, [0, 1.06, 0]);
  return fit(kit.geometry(), "wrist", 0.85 + 0.04 * (variant % 3));
}

function link(variant: number): THREE.BufferGeometry {
  const kit = new Kit();
  const len = 1.15 + 0.12 * variant;
  const tilt = 0.18 + 0.06 * (variant % 2);
  kit.cyl(0.32, 0.06, C.dark, [0, 0.03, 0]);
  kit.cyl(0.03, 0.42, C.metal, [0, 0.27, 0]);
  const a: [number, number] = [-Math.sin(tilt) * len * 0.5, 0.5];
  const b: [number, number] = [Math.sin(tilt) * len * 0.5, 0.5 + Math.cos(tilt) * len];
  kit.bar(a, b, 0.15, variant % 2 ? C.paint : C.graphite, C.dark, 0.21);
  kit.cyl(0.21, 0.34, C.dark, [0, b[1], b[0]], [0, 0, Math.PI / 2]);
  return fit(kit.geometry(), "link", 0.9);
}

function motor(variant: number): THREE.BufferGeometry {
  const kit = new Kit();
  kit.box(0.5, 0.06, 0.5, C.dark, [0, 0.03, 0]);
  kit.cyl(0.3, 0.55, C.metal, [0, 0.34, 0]);
  for (let i = 0; i < 5; i++) kit.cyl(0.315, 0.03, C.graphite, [0, 0.14 + i * 0.1, 0]);
  kit.cyl(0.05, 0.22, C.metal, [0, 0.72, 0]);
  kit.box(0.2, 0.15, 0.16, variant % 2 ? C.amber : C.dark, [0.3, 0.3, 0]);
  return fit(kit.geometry(), "motor", 0.88);
}

function base(variant: number): THREE.BufferGeometry {
  const kit = new Kit();
  kit.cyl(0.5, 0.18, C.dark, [0, 0.09, 0]);
  kit.cyl(0.42, 0.06, C.paint, [0, 0.21, 0]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    kit.cyl(0.03, 0.05, C.metal, [Math.cos(a) * 0.34, 0.26, Math.sin(a) * 0.34]);
  }
  kit.cyl(0.26, 0.35, variant % 2 ? C.graphite : C.paint, [0, 0.42, 0]);
  kit.cyl(0.265, 0.025, C.teal, [0, 0.58, 0]);
  return fit(kit.geometry(), "base", 0.86);
}

export function partGeometry(kind: Exclude<ItemKind, "robot" | "franka-link">, variant: number): THREE.BufferGeometry {
  if (kind === "gripper") return gripper(variant);
  if (kind === "wrist") return wrist(variant);
  if (kind === "link") return link(variant);
  if (kind === "motor") return motor(variant);
  return base(variant);
}

/**
 * The arms with no mesh on the site, as simple stand-ins in profile (z along the wall, y up): their
 * joint chain, link radius, colours and gripper. Shapes only suggest each arm; they aren't its real
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
  openarm: { base: { r: 0.08, h: 0.14, block: true }, points: [[0, 0.14], [0, 0.3], [0.1, 0.52], [0.33, 0.48], [0.4, 0.34]], r: 0.038, link: C.dark, joint: C.metal, gripper: 0 },
  so101: { base: { r: 0.05, h: 0.05, block: true }, points: [[0, 0.05], [0, 0.11], [0.06, 0.25], [0.18, 0.24], [0.22, 0.16]], r: 0.018, link: C.paint, joint: C.dark, gripper: 2 },
  piper: { base: { r: 0.07, h: 0.08 }, points: [[0, 0.08], [0, 0.16], [0.14, 0.33], [0.33, 0.31], [0.37, 0.2]], r: 0.032, link: C.metal, joint: C.dark, gripper: 0 },
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
  return fit(kit.geometry(), "robot");
}

type MeshLike = THREE.Mesh & { geometry: THREE.BufferGeometry };

/** The meshes of one URDF link, without its child links', in the link's own frame. */
function linkMeshes(link: THREE.Object3D): THREE.BufferGeometry[] {
  const inv = new THREE.Matrix4().copy(link.matrixWorld).invert();
  const out: THREE.BufferGeometry[] = [];
  const walk = (o: THREE.Object3D) => {
    for (const c of o.children) {
      const u = c as THREE.Object3D & { isURDFLink?: boolean; isURDFJoint?: boolean };
      if (u.isURDFLink || u.isURDFJoint) continue;
      if ((c as MeshLike).isMesh) out.push((c as MeshLike).geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld)));
      walk(c);
    }
  };
  walk(link);
  return out;
}

export interface FrankaPieces {
  /** The whole arm in Isaac Lab's start pose, in profile. */
  arm: THREE.BufferGeometry;
  /** Single links as specimens. */
  links: Record<(typeof FRANKA_LINKS)[number], THREE.BufferGeometry>;
}

/** The Franka from its URDF's collision meshes (urdf-loader, as the twin loads it). */
export function frankaPieces(robot: URDFRobot): FrankaPieces {
  for (const [name, v] of Object.entries(FRANKA.rest)) robot.joints[name]?.setJointValue(v);
  robot.updateMatrixWorld(true);
  const colorOf = (name: string) => (/finger/.test(name) ? C.dark : /link0/.test(name) ? C.graphite : C.paint);
  // URDF is z-up; the wall is y-up. The arm reaches along +x: turn it a quarter so it reaches along the wall.
  const zUp = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const side = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  const rootInv = new THREE.Matrix4().copy(robot.matrixWorld).invert();
  const arm = new Kit();
  for (const [name, l] of Object.entries(robot.links)) {
    const toRoot = new THREE.Matrix4().multiplyMatrices(rootInv, l.matrixWorld);
    for (const g of linkMeshes(l)) arm.add(g.applyMatrix4(toRoot).applyMatrix4(zUp).applyMatrix4(side), colorOf(name));
  }
  const links = {} as FrankaPieces["links"];
  for (const name of FRANKA_LINKS) {
    const l = robot.links[`panda_${name}`];
    if (!l) throw new Error(`world: the Franka URDF has no panda_${name}`);
    // On display: the link on a thin rod over a small foot.
    const mesh = new Kit();
    for (const g of linkMeshes(l)) mesh.add(g.applyMatrix4(zUp), C.paint);
    const kit = new Kit();
    kit.add(fit(mesh.geometry(), "franka-link", 0.62).translate(0, 0.5, 0), null);
    kit.cyl(0.24, 0.05, C.dark, [0, 0.025, 0]);
    kit.cyl(0.03, 0.5, C.metal, [0, 0.27, 0]);
    links[name] = fit(kit.geometry(), "franka-link", 0.95);
  }
  return { arm: fit(arm.geometry(), "robot"), links };
}

/** The picture light over an item: under the board above it, out toward the room. */
function spotFor(it: WallItem): THREE.Vector3 {
  const [x, y, z] = itemBase(it);
  return new THREE.Vector3(x - it.side * SPOT_OUT, y + SPOT_UP, z);
}

/** An item's local geometry (null: the Franka's meshes aren't in yet). */
function itemGeometry(it: WallItem, franka: FrankaPieces | null): THREE.BufferGeometry | null {
  if (it.kind === "robot") return it.robot === "franka" ? franka?.arm.clone() ?? null : standIn(it.robot!);
  if (it.kind === "franka-link") return franka ? franka.links[it.mesh!].clone() : null;
  return partGeometry(it.kind, it.variant);
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
export function buildWall(plan: readonly WallItem[], franka: FrankaPieces | null): THREE.BufferGeometry {
  const ids = CATALOG.map((r) => r.id);
  const all: THREE.BufferGeometry[] = [];
  for (const it of plan) {
    const size = ITEM_SIZE[it.kind];
    const kit = new Kit(10);
    kit.box(size.width * 0.86, PLINTH_H, size.depth * 0.95, C.plinth, [0, PLINTH_H / 2, 0]);
    // The museum card on the board's front edge, tilted up to the room.
    kit.box(Math.min(0.55, size.width * 0.4), 0.03, 0.22, C.card, [0.72, 0.06, size.width * 0.18], [0, 0, -0.5]);
    const stand = kit.geometry();
    const g = itemGeometry(it, franka)?.translate(0, PLINTH_H, 0) ?? null;
    // The plinth and the card keep number 0: only the robot itself lights up.
    const item = g ? mergeGeometries([withSpot(stand, it, 0), withSpot(g, it, it.robot ? ids.indexOf(it.robot) + 1 : 0)])! : withSpot(stand, it, 0);
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

