// The robot twin and the bottom trace on /record: the arm's target over the live scene, from the
// same pose updates as the rest of the page (liveHud). Pure, so the geometry is tested without a
// browser. The scene is the live sink's fixed one; the sim doesn't stream the cube while you move
// it, so the twin shows where the cube starts and where the bin is, and the target moving over them.

import { GRASP_Z, WORKSPACE, initialHud, type HudState } from "../record-hud";
import type { PoseUi } from "../../record/useRecordSession";
import { LIVE_HISTORY, stepLiveHud } from "./liveHud";

/** The live sink's robot: teleop_sink.py --robot only accepts franka (Isaac Lab's Franka Panda). */
export const LIVE_ROBOT = { code: "FRANKA", name: "Franka Panda" } as const;

/** teleop_sink.py base_scene (cube start, bin_pose_for(0.5, 0.3)) and scene_cfg.py sizes, in meters. Update together. */
export const SCENE = {
  cube: { x: 0.5, y: 0, size: 0.05 },
  bin: { x: 0.5, y: 0.3, outer: 0.22, height: 0.09 },
} as const;

/** What the twin's two views show: a little more than the workspace, so the whole bin fits. */
export const TOP_VIEW = { x: [0.25, 0.75] as const, y: [-0.45, 0.45] as const };
export const SIDE_VIEW = { x: TOP_VIEW.x, z: [0, 0.42] as const };

export { GRASP_Z, WORKSPACE };

export type Box = { left: number; top: number; width: number; height: number };

const span = ([a, b]: readonly [number, number]) => b - a;

/** The largest box of this aspect (width / height) inside w x h, centered. */
export function fitBox(w: number, h: number, aspect: number, left = 0, top = 0): Box {
  const width = Math.max(0, Math.min(w, h * aspect));
  const height = width / aspect;
  return { left: left + (w - width) / 2, top: top + (h - height) / 2, width, height };
}

/**
 * Top view, seen from behind the robot like the operator: forward (+x) is up, and the robot's left
 * (+y) is on the left, so the dot moves the way the hand does in the mirrored camera view.
 */
export function topPoint(x: number, y: number, b: Box): [number, number] {
  return [b.left + ((TOP_VIEW.y[1] - y) / span(TOP_VIEW.y)) * b.width, b.top + ((TOP_VIEW.x[1] - x) / span(TOP_VIEW.x)) * b.height];
}

/** Side view: reach (x) to the right, height (z) up, the table at z = 0. */
export function sidePoint(x: number, z: number, b: Box): [number, number] {
  return [b.left + ((x - SIDE_VIEW.x[0]) / span(SIDE_VIEW.x)) * b.width, b.top + ((SIDE_VIEW.z[1] - z) / span(SIDE_VIEW.z)) * b.height];
}

/** An SVG path through the points; empty for none. */
export function pathOf(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
}

/**
 * A trace's x positions: the newest sample at the right edge, one step per sample, so a short
 * history grows in from the right like the preview's traces.
 */
export function traceX(i: number, n: number, width: number, capacity = LIVE_HISTORY): number {
  return (width * (capacity - n + i)) / (capacity - 1);
}

/** values in [lo, hi] -> a trace path across w x h (high values at the top), clamped. */
export function tracePath(values: readonly number[], [lo, hi]: readonly [number, number], w: number, h: number, capacity = LIVE_HISTORY): string {
  const n = values.length;
  return pathOf(values.map((v, i) => [traceX(i, n, w, capacity), h - Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * h] as const));
}

/** The rack's state plus the twin's and the trace's own histories (target y, gripper). */
export interface LiveState {
  hud: HudState;
  yHistory: number[];
  gripHistory: (0 | 1)[];
}

export function initialLive(): LiveState {
  return { hud: initialHud(), yHistory: [], gripHistory: [] };
}

function push<T>(list: readonly T[], value: T): T[] {
  const next = list.length >= LIVE_HISTORY ? list.slice(list.length - LIVE_HISTORY + 1) : list.slice();
  next.push(value);
  return next;
}

/** One pose update in. The extra histories grow with liveHud's (tracked poses only) and empty with it. */
export function stepLive(prev: LiveState, pose: PoseUi | null): LiveState {
  const hud = stepLiveHud(prev.hud, pose);
  if (!pose) return { hud, yHistory: [], gripHistory: [] };
  if (!pose.msg.tracking_ok || !hud.target) return { ...prev, hud };
  return { hud, yHistory: push(prev.yHistory, hud.target.ee[1]), gripHistory: push(prev.gripHistory, hud.gripper) };
}
