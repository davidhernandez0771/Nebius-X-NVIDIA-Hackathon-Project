// The hero's tesseract, the SANT mark (docs/design/logo): a 4D cube, its 16 corners (±1 on x, y, z, w) and 32
// edges, turned in 4D and projected to 3D scaled by depth in w, so the inner cube (w = -1, teal) and the outer one
// (w = +1) keep turning inside out into each other. One outer corner is broken open: its edges stop short of it in
// 4D, so the gap holds through every turn, and the teal cube passes through it. Pure, so the tests hold the maths;
// Tesseract.ts draws it, Scene.tsx poses it.
import * as THREE from "three";
import { span } from "./storyPlan";

export type Vec4 = readonly [number, number, number, number];

/** The corners: bit k of the index is the sign on axis k (x, y, z, w). */
export const VERTICES: Vec4[] = Array.from({ length: 16 }, (_, i) => [0, 1, 2, 3].map((k) => (i & (1 << k) ? 1 : -1)) as unknown as Vec4);

/** Two corners that differ on one axis. */
export const EDGES: [number, number][] = [];
for (let i = 0; i < 16; i++) for (let k = 0; k < 4; k++) if (!(i & (1 << k))) EDGES.push([i, i | (1 << k)]);

export type EdgeKind = "inner" | "outer" | "link";

export const edgeKind = ([a, b]: readonly [number, number]): EdgeKind => {
  const wa = VERTICES[a][3], wb = VERTICES[b][3];
  return wa !== wb ? "link" : wa < 0 ? "inner" : "outer";
};

/** The inner cube's size to the outer one's at rest, as in the flat mark (3/7, about 0.43). */
export const INNER_RATIO = 3 / 7;
/** The outer cube's half size in the logo's units (the old logo ring's radius is 1). */
export const HALF = 0.5;

/** 4D → 3D, scaled by depth in w: nearer in w is larger, INNER_RATIO for each unit of w further away, so the outer
 *  cube (w = 1) has half size HALF and the inner one (w = -1) INNER_RATIO of it. A true perspective in w at this
 *  ratio (the eye at w = 2.5) blows a corner up to 2.6 times the logo's size as it swings near the eye; this keeps
 *  the same turning inside out within HYPER_RADIUS, so the hero can fit it on screen. */
export function project(v: readonly number[]): [number, number, number] {
  const f = HALF * INNER_RATIO ** ((1 - v[3]) / 2);
  return [v[0] * f, v[1] * f, v[2] * f];
}

/** The angles of the turn, in the XW and ZW planes: the hypercube turning inside out. */
export interface Angles4 {
  xw: number;
  zw: number;
}

/** The isometric view of the flat mark: a cube seen down its diagonal (three.js Euler, XYZ). */
export const ISO = new THREE.Euler(Math.atan(1 / Math.SQRT2), -Math.PI / 4, 0, "XYZ");

/** The open corner: the outer corner that sits up and to the right (30°) in the mark's isometric view. */
export const OPEN: number = (() => {
  const iso = new THREE.Matrix4().makeRotationFromEuler(ISO);
  let best = -1, score = -Infinity;
  VERTICES.forEach((v, i) => {
    if (v[3] !== 1) return;
    const p = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(iso);
    const s = p.x * Math.cos(Math.PI / 6) + p.y * Math.sin(Math.PI / 6);
    if (s > score) [best, score] = [i, s];
  });
  return best;
})();

/** The open corner's direction in 3D (unit). */
const U = (() => {
  const [x, y, z] = VERTICES[OPEN];
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l] as const;
})();

/** A 4D rotation: XW, then ZW. Lengths are kept. */
export function rotate4(v: readonly number[], a: Angles4): [number, number, number, number] {
  let [x, y, z, w] = v;
  const cx = Math.cos(a.xw), sx = Math.sin(a.xw);
  [x, w] = [x * cx - w * sx, x * sx + w * cx];
  const cz = Math.cos(a.zw), sz = Math.sin(a.zw);
  [z, w] = [z * cz - w * sz, z * sz + w * cz];
  return [x, y, z, w];
}

/** The still pose, the flat mark's: no turn. */
export const STILL: Angles4 = { xw: 0, zw: 0 };

/** How far the inner cube is pushed toward the open corner, in 4D units: the teal cube breaking out through the
 *  gap. A shear, so the outer cube (w = 1) stays a true cube. */
export const BREAKOUT = 0.5;

/** A corner where it sits before any turn: the inner cube (w = -1) shifted toward the open corner. */
export function shear4(v: readonly number[]): [number, number, number, number] {
  const k = (BREAKOUT * (1 - v[3])) / 2;
  return [v[0] + k * U[0], v[1] + k * U[1], v[2] + k * U[2], v[3]];
}

/** A corner (or any 4D point of the tesseract) at these angles: sheared, then turned. */
export const place4 = (v: readonly number[], a: Angles4) => rotate4(shear4(v), a);

/** The farthest any corner reaches from the centre, at any angle (logo units): what the hero fits on screen. */
export const HYPER_RADIUS: number = (() => {
  let r = 0;
  const n = 72;
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++) {
      const angles = { xw: (a / n) * Math.PI * 2, zw: (b / n) * Math.PI * 2 };
      for (const v of VERTICES) r = Math.max(r, Math.hypot(...project(place4(v, angles))));
    }
  // The grid can step past a peak by a little.
  return r * 1.02;
})();

/** How far toward the open corner its edges reach (of their length, in 4D). */
export const OPEN_REACH = 0.62;

export interface Tube {
  edge: number;
  kind: EdgeKind;
  from: THREE.Vector3;
  to: THREE.Vector3;
  length: number;
}

export interface Joint {
  vertex: number;
  kind: "inner" | "outer";
  at: THREE.Vector3;
}

export interface HyperFrame {
  tubes: Tube[];
  joints: Joint[];
}

const lerp4 = (a: Vec4, b: Vec4, t: number) => a.map((c, i) => c + (b[i] - c) * t);

/** The tesseract at these angles, in 3D: every edge as a tube from one end to the other (or toward the open corner,
 *  stopping short), a joint at every corner but the open one. */
export function hyperFrame(a: Angles4): HyperFrame {
  const at = (v: readonly number[]) => new THREE.Vector3(...project(place4(v, a)));
  const P = VERTICES.map(at);
  const tubes = EDGES.map(([i, j], edge) => {
    const open = i === OPEN || j === OPEN;
    const from = open ? P[i === OPEN ? j : i] : P[i];
    const to = open ? at(lerp4(VERTICES[i === OPEN ? j : i], VERTICES[OPEN], OPEN_REACH)) : P[j];
    return { edge, kind: edgeKind([i, j]), from, to, length: from.distanceTo(to) };
  });
  const joints = P.flatMap((p, vertex) => (vertex === OPEN ? [] : [{ vertex, kind: VERTICES[vertex][3] < 0 ? ("inner" as const) : ("outer" as const), at: p }]));
  return { tubes, joints };
}

/** Radians of 4D turn the hero's scroll gives, from the top to the end of the sink. */
const SCROLL_TURN = Math.PI * 1.5;
/** Radians a second of its own slow 4D turn (idle). */
export const IDLE_TURN = 0.25;
/** The ZW turn runs at this fraction of the XW one, so the two never line up into a simple loop. */
const ZW_RATIO = 0.618;

const smoother = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);

/** The pose at scroll `vh` after `spin` seconds of idle turning; reduced motion holds the flat mark's pose. */
export function hyperPose(vh: number, spin: number, reduced: boolean): Angles4 {
  if (reduced) return { ...STILL };
  const [, end] = span("sink");
  const k = smoother(Math.min(1, Math.max(0, vh / end)));
  const turn = k * SCROLL_TURN + spin * IDLE_TURN;
  return { xw: turn, zw: turn * ZW_RATIO };
}
