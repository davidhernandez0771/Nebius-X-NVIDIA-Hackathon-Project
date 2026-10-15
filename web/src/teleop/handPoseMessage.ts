// Webcam hand -> HandPoseMsg, the message the teleop relay forwards to the sim
// worker (spec 8.1). Field names match demo_pipeline.teleop.HandPoseMsg exactly;
// __fixtures__/hand_pose_msg.json pins the shape on both sides.
//
// Everything here is measured on the RAW, unmirrored camera frame; mirroring
// for the user's view happens in the sim worker's to_ee_target(). Distances and
// angles are taken in pixels (x * frameWidth, y * frameHeight) so they stay
// correct on non-square frames such as 1280x720.

import { LANDMARK, type HandLandmark, type TrackedHand } from "../hand/contracts";

/** Not in contracts.ts's LANDMARK table; MediaPipe's pinky MCP. */
const PINKY_MCP = 17;

export interface HandPoseMsg {
  t_ms: number; // performance.now()
  tracking_ok: boolean; // false: no hand; other fields are the last known values, or 0
  wrist_uv: [number, number]; // landmark 0, raw normalized coords, clamped to [0, 1]
  palm_width: number; // |lm5 - lm17| px / frame_w
  pinch_ratio: number; // |lm4 - lm8| px / |lm5 - lm17| px
  yaw_rad: number; // atan2(dx, -dy) of lm0 -> lm9 in px; up = 0, raw right = +pi/2
  frame_w: number;
  frame_h: number;
}

export interface FrameInfo {
  timestamp: number;
  frameWidth: number;
  frameHeight: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function toHandPoseMsg(hand: TrackedHand | null, frame: FrameInfo, last?: HandPoseMsg): HandPoseMsg {
  const { timestamp, frameWidth: w, frameHeight: h } = frame;
  const untracked = (): HandPoseMsg => ({
    ...(last ?? { wrist_uv: [0, 0], palm_width: 0, pinch_ratio: 0, yaw_rad: 0 }),
    t_ms: timestamp,
    tracking_ok: false,
    frame_w: w,
    frame_h: h,
  });
  if (!hand) return untracked();

  const lm = hand.landmarks;
  const px = (p: HandLandmark): [number, number] => [p.x * w, p.y * h];
  const dist = (a: HandLandmark, b: HandLandmark): number => {
    const [ax, ay] = px(a);
    const [bx, by] = px(b);
    return Math.hypot(ax - bx, ay - by);
  };

  const palmPx = dist(lm[LANDMARK.INDEX_MCP], lm[PINKY_MCP]);
  const [wx, wy] = px(lm[LANDMARK.WRIST]);
  const [mx, my] = px(lm[LANDMARK.MIDDLE_MCP]);
  const msg: HandPoseMsg = {
    t_ms: timestamp,
    tracking_ok: true,
    wrist_uv: [clamp01(lm[LANDMARK.WRIST].x), clamp01(lm[LANDMARK.WRIST].y)],
    palm_width: palmPx / w,
    pinch_ratio: dist(lm[LANDMARK.THUMB_TIP], lm[LANDMARK.INDEX_TIP]) / palmPx,
    yaw_rad: Math.atan2(mx - wx, -(my - wy)),
    frame_w: w,
    frame_h: h,
  };

  // A collapsed palm or NaN landmark would be rejected by the backend; report "no hand" instead.
  const numbers = [msg.palm_width, msg.pinch_ratio, msg.yaw_rad, ...msg.wrist_uv];
  if (!(palmPx > 0) || !numbers.every(Number.isFinite)) return untracked();
  return msg;
}
