// The Record HUD's numbers, from the same HandPoseMsg the sim worker receives. toTarget mirrors
// demo_pipeline.teleop.to_ee_target (src/demo_pipeline/teleop.py) and the gripper uses the sim's
// latch, so the rack shows what the arm will do, not a separate guess. Pure, so the preview's
// fixture and T4's live stream go through the same code.

import { CALIBRATION, GRIPPER, TABLE_MARK, Z_RANGE, nextGripper } from "../../pm/record/framing";
import type { HandPoseMsg } from "../../teleop/handPoseMessage";

/** teleop.py Calibration's workspace in meters (Isaac Lab world frame, z up). Update together. */
export const WORKSPACE = {
  x: [0.3, 0.7] as const,
  y: [-0.35, 0.35] as const,
  z: Z_RANGE,
};

/** The cube's center height, the grasp height the trace marks (framing.ts CUBE_Z). */
export const GRASP_Z = Z_RANGE[0] + TABLE_MARK * (Z_RANGE[1] - Z_RANGE[0]);

export { GRIPPER };

/** Samples kept for the traces and the palm trail: 8 s at the ~30 Hz message rate. */
export const HISTORY = 240;

export type Point = readonly [number, number];

export interface Target {
  /** End-effector target [x, y, z] in meters. */
  ee: [number, number, number];
  /** The palm in the control region as the user sees it (mirrored): 0..1, top-left origin. */
  pad: { x: number; y: number };
  /** The hand is outside the region, so the arm has stopped following on at least one axis. */
  edge: boolean;
  yawDeg: number;
}

export interface HudState {
  t_ms: number;
  tracking: boolean;
  /** Last target; held while tracking is lost. Null before the first tracked message. */
  target: Target | null;
  pinch: number | null;
  gripper: 0 | 1;
  /** Landmarks of the current message in raw frame coordinates, null without a hand. */
  landmarks: readonly Point[] | null;
  zHistory: number[];
  xHistory: number[];
  /** Palm center (landmark 9) over time, raw frame coordinates. */
  trail: Point[];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const fraction = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo));
const lerp = (s: number, [a, b]: readonly [number, number]) => a + s * (b - a);
const outside = (v: number, lo: number, hi: number) => v < lo || v > hi;

export function toTarget(msg: HandPoseMsg): Target {
  const c = CALIBRATION;
  let sY: number;
  let sZ: number;
  let sX: number;
  let edge: boolean;
  if (msg.control) {
    const [u, v, depth] = msg.control;
    sY = clamp01(1 - u);
    sZ = clamp01(1 - v);
    sX = clamp01(depth);
    edge = false;
  } else {
    const [u, v] = msg.wrist_uv;
    sY = fraction(1 - u, c.u_min, c.u_max);
    sZ = fraction(1 - v, 1 - c.v_max, 1 - c.v_min);
    sX = fraction(msg.palm_width, c.palm_far, c.palm_near);
    edge = outside(1 - u, c.u_min, c.u_max) || outside(v, c.v_min, c.v_max) || outside(msg.palm_width, c.palm_far, c.palm_near);
  }
  return {
    ee: [lerp(sX, WORKSPACE.x), lerp(sY, [WORKSPACE.y[1], WORKSPACE.y[0]]), lerp(sZ, WORKSPACE.z)],
    // y follows the mirrored u left to right; the pad's y runs down, so high hands sit at the top.
    pad: { x: sY, y: 1 - sZ },
    edge,
    yawDeg: (msg.yaw_rad * 180) / Math.PI,
  };
}

export function initialHud(): HudState {
  return { t_ms: 0, tracking: false, target: null, pinch: null, gripper: 0, landmarks: null, zHistory: [], xHistory: [], trail: [] };
}

function push<T>(list: T[], value: T): T[] {
  const next = list.length >= HISTORY ? list.slice(list.length - HISTORY + 1) : list.slice();
  next.push(value);
  return next;
}

/** One message in: the next HUD state. While tracking is lost the target and gripper hold. */
export function stepHud(prev: HudState, msg: HandPoseMsg, landmarks: readonly Point[] | null = null): HudState {
  const gripper = nextGripper(prev.gripper, msg);
  if (!msg.tracking_ok) return { ...prev, t_ms: msg.t_ms, tracking: false, gripper, landmarks: null };
  const target = toTarget(msg);
  const palm = landmarks?.[9];
  return {
    t_ms: msg.t_ms,
    tracking: true,
    target,
    pinch: msg.pinch_ratio,
    gripper,
    landmarks,
    zHistory: push(prev.zHistory, target.ee[2]),
    xHistory: push(prev.xHistory, target.ee[0]),
    trail: palm ? push(prev.trail, palm) : prev.trail,
  };
}

/**
 * Index of the newest frame at or before t, looping: the session lasts one frame period past its
 * last frame, then starts again.
 */
export function frameAt(frames: readonly { t_ms: number }[], t: number): number {
  const n = frames.length;
  if (n < 2) return 0;
  const period = (frames[n - 1].t_ms - frames[0].t_ms) / (n - 1);
  const span = frames[n - 1].t_ms - frames[0].t_ms + period;
  const local = frames[0].t_ms + (((t - frames[0].t_ms) % span) + span) % span;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t_ms <= local) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function meanRateHz(frames: readonly { t_ms: number }[]): number | null {
  if (frames.length < 2) return null;
  return ((frames.length - 1) * 1000) / (frames[frames.length - 1].t_ms - frames[0].t_ms);
}

/** "mm:ss.d", fixed width so the timer never jumps. */
export function formatClock(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor(tenths / 10) % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

/** Needle angle in degrees for a 270° knob centered on the top; reversed runs right to left. */
export function knobAngle(value: number, min: number, max: number, reverse = false): number {
  const f = fraction(value, min, max);
  return -135 + (reverse ? 1 - f : f) * 270;
}
