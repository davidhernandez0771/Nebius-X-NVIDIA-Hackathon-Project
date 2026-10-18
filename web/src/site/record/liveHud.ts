// The live rack's numbers. T7's hudModel.stepHud models the sim's own pinch_ratio latch; hand v4
// decides the gripper in the browser (PinchLatch on the pinch gap, sent as HandPoseMsg.grip), so
// the live rack takes the gripper and the gap from the session instead, and the target from the
// same toTarget (teleop.py's to_ee_target). The session's pose updates at ~10 Hz, so 80 samples
// keep the traces at 8 s like the preview's.

import type { PoseUi } from "../../record/useRecordSession";
import { initialHud, toTarget, type HudState, type Point } from "../record-hud";

/** The session's UI rate (useRecordSession: one pose update per ~100 ms). */
export const LIVE_HZ = 10;
/** 8 s of history at LIVE_HZ, like the preview's traces. */
export const LIVE_HISTORY = 8 * LIVE_HZ;

function push<T>(list: readonly T[], value: T): T[] {
  const next = list.length >= LIVE_HISTORY ? list.slice(list.length - LIVE_HISTORY + 1) : list.slice();
  next.push(value);
  return next;
}

/** One pose update in: the next HUD state. Without a pose (camera off) the rack is empty. */
export function stepLiveHud(prev: HudState, pose: PoseUi | null): HudState {
  if (!pose) return initialHud();
  const { msg } = pose;
  // Tracking lost: the arm holds its last target, the gripper holds too (the latch's output), and
  // the knob keeps the last pinch seen, dimmed.
  if (!msg.tracking_ok) return { ...prev, t_ms: msg.t_ms, tracking: false, gripper: pose.gripper, landmarks: null };
  // toTarget only flags an edge for the sim's own wrist box; with the control region the session's
  // framing knows when the hand has left the region or the depth range.
  const target = { ...toTarget(msg), edge: pose.framing.state === "edge" };
  const landmarks = (pose.landmarks ?? null) as readonly Point[] | null;
  const palm = landmarks?.[9];
  return {
    t_ms: msg.t_ms,
    tracking: true,
    target,
    pinch: pose.pinch,
    gripper: pose.gripper,
    landmarks,
    zHistory: push(prev.zHistory, target.ee[2]),
    xHistory: push(prev.xHistory, target.ee[0]),
    trail: palm ? push(prev.trail, palm) : prev.trail,
  };
}
