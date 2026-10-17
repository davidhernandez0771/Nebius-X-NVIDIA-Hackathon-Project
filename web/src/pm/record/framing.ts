// Framing guide for the Record page. The sim worker maps the hand into the
// robot workspace with demo_pipeline.teleop.Calibration; a hand outside these
// ranges is clamped there, so the arm stops following. These are that class's
// defaults (src/demo_pipeline/teleop.py); update both together.

import type { TeleopControlSettings } from "../../teleop/controlRegion";
import type { HandPoseMsg } from "../../teleop/handPoseMessage";

export const CALIBRATION = {
  u_min: 0.2,
  u_max: 0.8,
  v_min: 0.15,
  v_max: 0.85,
  palm_far: 0.06,
  palm_near: 0.14,
} as const;

export interface Framing {
  state: "no-hand" | "ok" | "edge";
  hints: string[];
}

export function framingCheck(msg: Pick<HandPoseMsg, "tracking_ok" | "wrist_uv" | "palm_width">): Framing {
  if (!msg.tracking_ok) return { state: "no-hand", hints: [] };
  const [u, v] = msg.wrist_uv;
  const c = CALIBRATION;
  const hints: string[] = [];
  // u is the raw camera frame; the user watches a mirror, so raw left is their right.
  if (u < c.u_min) hints.push("Move your hand left");
  else if (u > c.u_max) hints.push("Move your hand right");
  if (v < c.v_min) hints.push("Move your hand down");
  else if (v > c.v_max) hints.push("Move your hand up");
  if (msg.palm_width < c.palm_far) hints.push("Bring your hand closer");
  else if (msg.palm_width > c.palm_near) hints.push("Move your hand back");
  return { state: hints.length ? "edge" : "ok", hints };
}

// --- With the control region on (web/src/teleop/controlRegion.ts) ---------------------------

/** Same hints as framingCheck, for the palm center against the user's control region and depth range. */
export function controlFraming(
  hand: { center: { x: number; y: number }; palmWidth: number } | null,
  s: TeleopControlSettings,
): Framing {
  if (!hand) return { state: "no-hand", hints: [] };
  const { x, y } = hand.center;
  const r = s.region;
  const hints: string[] = [];
  if (x < r.centerX - r.width / 2) hints.push("Move your hand left");
  else if (x > r.centerX + r.width / 2) hints.push("Move your hand right");
  if (y < r.centerY - r.height / 2) hints.push("Move your hand down");
  else if (y > r.centerY + r.height / 2) hints.push("Move your hand up");
  if (hand.palmWidth < s.depthFar) hints.push("Bring your hand closer");
  else if (hand.palmWidth > s.depthNear) hints.push("Move your hand back");
  return { state: hints.length ? "edge" : "ok", hints };
}

// demo_pipeline.teleop.Calibration's z_range, and the cube's center height on the table
// (the grasp height). Update together with teleop.py.
export const Z_RANGE: readonly [number, number] = [0.02, 0.4];
const CUBE_Z = 0.025;
export const TABLE_MARK = (CUBE_Z - Z_RANGE[0]) / (Z_RANGE[1] - Z_RANGE[0]);

/** The arm's target height for a control triple, as to_ee_target computes it (z follows 1 - v). */
export function robotHeight(control: readonly [number, number, number]): { fraction: number; z: number } {
  const fraction = Math.min(1, Math.max(0, 1 - control[1]));
  return { fraction, z: Z_RANGE[0] + fraction * (Z_RANGE[1] - Z_RANGE[0]) };
}

// Calibration's x_range (reach, back to forward), and the live scene's cube row
// (sim_worker/scripts/teleop_sink.py base_scene: cube at x 0.50). Update together.
export const X_RANGE: readonly [number, number] = [0.3, 0.7];
const CUBE_X = 0.5;
export const CUBE_ROW = (CUBE_X - X_RANGE[0]) / (X_RANGE[1] - X_RANGE[0]);

/** The arm's target reach for a control triple, as to_ee_target computes it (x follows depth). */
export function robotReach(control: readonly [number, number, number]): { fraction: number; x: number } {
  const fraction = Math.min(1, Math.max(0, control[2]));
  return { fraction, x: X_RANGE[0] + fraction * (X_RANGE[1] - X_RANGE[0]) };
}

/** demo_pipeline.teleop.GripperLatch's thresholds, so the page shows what the sim will do. */
export const GRIPPER = { closeBelow: 0.35, openAbove: 0.45 } as const;

export function nextGripper(prev: 0 | 1, msg: Pick<HandPoseMsg, "tracking_ok" | "pinch_ratio">): 0 | 1 {
  if (!msg.tracking_ok) return prev;
  if (msg.pinch_ratio < GRIPPER.closeBelow) return 1;
  if (msg.pinch_ratio > GRIPPER.openAbove) return 0;
  return prev;
}
