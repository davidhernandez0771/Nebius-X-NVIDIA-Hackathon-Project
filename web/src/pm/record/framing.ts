// Framing guide for the Record page. The sim worker maps the hand into the
// robot workspace with demo_pipeline.teleop.Calibration; a hand outside these
// ranges is clamped there, so the arm stops following. These are that class's
// defaults (src/demo_pipeline/teleop.py); update both together.

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
