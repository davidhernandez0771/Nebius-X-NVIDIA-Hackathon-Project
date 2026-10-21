// The twin's recording aids, without WebGL: where the gripper's tool point is in the env frame, what it should line
// up with (the cube while carrying nothing, the bin's centre while carrying it), how far off it is, and whether it
// is lined up; plus the layout of the three views (front, side, top) and the alignment grid, and the grid's own
// mapping. Env frame: metres, z up, as the sim (./types.ts).
import type { URDFRobot } from "urdf-loader";
import { applyJoints, CUBE_SIZE, FRANKA, toolPoint } from "./model";
import type { QuatWxyz, TwinPose, Vec3 } from "./types";

/** The tool point within this of the cube's centre, with the gripper closed: the cube is being carried. */
export const CARRY_RADIUS = 0.05;
/** The tool point within this of the cube's centre, seen from above: lined up to grasp it. */
export const ALIGN_RADIUS = 0.015;
/** Half the bin's inner width (scene_cfg.py BIN_INNER, 0.2 x 0.2 m). */
export const BIN_INNER_HALF = 0.1;

/** p rotated by q (w, x, y, z). */
export function rotate([w, x, y, z]: QuatWxyz, [px, py, pz]: Vec3): Vec3 {
  // t = 2 q.xyz × p; p' = p + w t + q.xyz × t
  const tx = 2 * (y * pz - z * py);
  const ty = 2 * (z * px - x * pz);
  const tz = 2 * (x * py - y * px);
  return [px + w * tx + (y * tz - z * ty), py + w * ty + (z * tx - x * tz), pz + w * tz + (x * ty - y * tx)];
}

const conj = ([w, x, y, z]: QuatWxyz): QuatWxyz => [w, -x, -y, -z];

/** A point in the robot's frame -> the env frame (the robot's root at `base`; the Franka's is the origin). */
export function toEnv(base: TwinPose | null, p: Vec3): Vec3 {
  if (!base) return p;
  const [x, y, z] = rotate(base.quat, p);
  return [x + base.pos[0], y + base.pos[1], z + base.pos[2]];
}

/** The tool point for these joints (null: the start pose), in the env frame. Poses the robot. */
export function toolInEnv(robot: URDFRobot, joints: Record<string, number> | null, base: TwinPose | null): Vec3 {
  applyJoints(robot, joints ?? FRANKA.rest);
  const p = toolPoint(robot);
  return toEnv(base, [p.x, p.y, p.z]);
}

/** Whether a point is over the bin's inner area (in the bin's own frame, so a turned bin counts). */
export function insideBin(p: Vec3, bin: TwinPose, half = BIN_INNER_HALF): boolean {
  const [x, y] = rotate(conj(bin.quat), [p[0] - bin.pos[0], p[1] - bin.pos[1], p[2] - bin.pos[2]]);
  return Math.abs(x) <= half && Math.abs(y) <= half;
}

export function isCarrying(tool: Vec3, cube: Vec3, gripper: 0 | 1 | null): boolean {
  return gripper === 1 && Math.hypot(tool[0] - cube[0], tool[1] - cube[1], tool[2] - cube[2]) <= CARRY_RADIUS;
}

export type Align = {
  /** What the tool point should line up with: the cube, or (carrying it) the bin. */
  kind: "cube" | "bin";
  /** The grid's centre: the cube's, or the bin's. */
  target: Vec3;
  tool: Vec3;
  cube: Vec3;
  /** target - tool, in metres: how far to move forward (x) and to the robot's left (y). */
  dx: number;
  dy: number;
  /** The tool point within ALIGN_RADIUS of above the cube; carrying, the cube over the bin's inner area. */
  aligned: boolean;
};

/** The alignment for one pose, or null without a cube (or a bin to carry it to). The target is the cube until it
 *  is carried; carried or already in the bin, it is the bin. */
export function alignState(tool: Vec3 | null, cube: TwinPose | null, bin: TwinPose | null, gripper: 0 | 1 | null): Align | null {
  if (!tool || !cube) return null;
  const c = cube.pos;
  const carrying = isCarrying(tool, c, gripper);
  if (carrying && !bin) return null;
  // carrying it, or already put in the bin (then it stays lit: nothing left to line up)
  if (bin && (carrying || insideBin(c, bin))) {
    const t = bin.pos;
    return { kind: "bin", target: t, tool, cube: c, dx: t[0] - tool[0], dy: t[1] - tool[1], aligned: insideBin(c, bin) };
  }
  const dx = c[0] - tool[0];
  const dy = c[1] - tool[1];
  return { kind: "cube", target: c, tool, cube: c, dx, dy, aligned: Math.hypot(dx, dy) <= ALIGN_RADIUS };
}

/** Metres -> signed centimetres to 0.1, with a real minus sign ("+2.3", "−0.8", "0.0"). */
export function formatCm(m: number): string {
  const cm = Math.round(m * 1000) / 10;
  if (cm === 0) return "0.0";
  return `${cm > 0 ? "+" : "−"}${Math.abs(cm).toFixed(1)}`;
}

// ---------------------------------------------------------------------------------------------------- layout

export type Rect = { x: number; y: number; w: number; h: number };
export type ViewLayout = { front: Rect; side: Rect; top: Rect; align: Rect };

/** The strip under the front view, as a share of the pane's height. */
export const STRIP = 0.42;
/** Between views: the pane's hairline shows through. */
export const GAP = 1;

/** The pane (CSS pixels, y down): the front view on top, then side, top and the alignment grid side by side. */
export function viewLayout(w: number, h: number): ViewLayout {
  const stripH = Math.round(h * STRIP);
  const frontH = Math.max(0, h - stripH - GAP);
  const cw = Math.max(0, (w - 2 * GAP) / 3);
  const y = frontH + GAP;
  const cell = (k: number): Rect => ({ x: Math.round(k * (cw + GAP)), y, w: Math.round((k + 1) * (cw + GAP) - GAP) - Math.round(k * (cw + GAP)), h: Math.max(0, h - y) });
  return { front: { x: 0, y: 0, w, h: frontH }, side: cell(0), top: cell(1), align: cell(2) };
}

/** A rect in CSS pixels, y down -> WebGL's viewport (x, y from the bottom, w, h). */
export function glRect(r: Rect, canvasH: number): [number, number, number, number] {
  return [r.x, canvasH - r.y - r.h, r.w, r.h];
}

/** The ortho camera's half extents that fit a region (half width, half height) into a view of this aspect. */
export function fitOrtho(halfU: number, halfV: number, aspect: number): { halfW: number; halfH: number } {
  const a = aspect > 0 ? aspect : 1;
  return halfU / halfV > a ? { halfW: halfU, halfH: halfU / a } : { halfW: halfV * a, halfH: halfV };
}

/** What the ortho views frame, in the env frame. Side: reach (x) to the right, height (z) up, from the robot's
 *  right. Top: forward (x) up, the robot's left (+y) on the left, as the operator stands. */
export const SIDE_REGION = { x: [0.12, 0.86] as const, z: [-0.04, 0.46] as const };
export const TOP_REGION = { x: [0.2, 0.8] as const, y: [-0.45, 0.45] as const };

// ---------------------------------------------------------------------------------------------------- the grid

/** The alignment grid shows this far around its centre (metres), each way. */
export const GRID_HALF = 0.15;
/** A grid line every this many metres. */
export const GRID_STEP = 0.05;

export type GridBox = { cx: number; cy: number; scale: number };

/** The grid's square plot inside a w x h cell, leaving `top` and `bottom` pixels for its tag and readout. */
export function gridBox(w: number, h: number, top = 18, bottom = 20): GridBox {
  const side = Math.max(0, Math.min(w - 12, h - top - bottom));
  return { cx: w / 2, cy: top + (h - top - bottom) / 2, scale: side / (2 * GRID_HALF) };
}

/** An env point -> the grid's pixels, centred on `centre`: forward (x) up, the robot's left (+y) on the left.
 *  Clamped to the plot's edge, so a far tool point still shows which way to go. */
export function gridPoint(p: Vec3, centre: Vec3, b: GridBox, clamp = true): [number, number] {
  const lim = (v: number) => (clamp ? Math.max(-GRID_HALF, Math.min(GRID_HALF, v)) : v);
  return [b.cx - lim(p[1] - centre[1]) * b.scale, b.cy - lim(p[0] - centre[0]) * b.scale];
}

/** A square's corners around a pose, in the env frame, turned with it (seen from above): the bin's inner area
 *  (half BIN_INNER_HALF) or the cube's footprint (half CUBE_HALF). */
export function squareCorners(pose: TwinPose, half: number): Vec3[] {
  return [
    [half, half],
    [half, -half],
    [-half, -half],
    [-half, half],
  ].map(([x, y]) => {
    const [rx, ry, rz] = rotate(pose.quat, [x, y, 0]);
    return [pose.pos[0] + rx, pose.pos[1] + ry, pose.pos[2] + rz] as Vec3;
  });
}

export const CUBE_HALF = CUBE_SIZE / 2;
