// One tracked hand per camera frame -> the HandPoseMsg the sim gets and the gripper, for the Record session. Pure
// and stateful (one per camera session), so the whole chain is tested over debug-trace frames:
//   1. the gripper: the pinch latch (pinch.ts), or the spacebar when that is the gripper input; held while clutched;
//   2. reach: the pinch-stable size (depthSignal.stableSize; the 3D size with 3D reach on), through DepthAnchor so
//      a gripper close or open never moves depth;
//   3. the message (handPoseMessage.ts), with the view's left/right (controlRegion.toControl);
//   4. sensitivity and the clutch (motionShaper.ts) on its control.

import type { TrackedHand } from "../../hand/contracts";
import type { TeleopControlSettings } from "./controlRegion";
import { DepthAnchor, stableSize } from "./depthSignal";
import { toHandPoseMsg, type FrameInfo, type HandPoseMsg } from "./handPoseMessage";
import { MotionShaper } from "./motionShaper";
import { PinchLatch, pinchGap } from "./pinch";
import { reachSize3d } from "./reach3d";

export interface ControlInput {
  clutch: boolean; // the clutch key is held
  spaceGripper: 0 | 1; // the spacebar's toggle state, used when settings.gripperInput is "space"
}

export interface ControlStep {
  msg: HandPoseMsg; // what the sim gets (sensitivity and clutch applied)
  gripper: 0 | 1;
  pinch: number | null; // the pinch gap this frame (null: no hand or a held frame)
  size3d: number | null; // the 3D reach signal (display and trace)
  stable: number | null; // the pinch-stable size before anchoring
  reachSize: number | null; // the reach used for depth (anchored)
  clutched: boolean;
}

export class HandControl {
  private readonly latch = new PinchLatch();
  private readonly anchor = new DepthAnchor();
  private readonly shaper = new MotionShaper();
  private last: HandPoseMsg | undefined; // the last message before shaping (depth smoothing runs on it)
  private sent: HandPoseMsg | undefined;

  /** held: the hand lock repeats the last pose this frame (no new evidence for the gripper). */
  step(hand: TrackedHand | null, frame: FrameInfo, s: TeleopControlSettings, input: ControlInput, held = false): ControlStep {
    const { timestamp: t, frameWidth: w, frameHeight: h } = frame;
    const pinch = hand && !held ? pinchGap(hand.landmarks, w, h) : null;
    const gripper = s.gripperInput === "space" ? input.spaceGripper : this.latch.update(input.clutch ? null : pinch, t);
    const size3d = hand ? reachSize3d(hand, w, h) : null;
    const stable = hand ? stableSize(hand.landmarks, w, h) : null;
    const signal = stable === null ? null : (s.reach3d && size3d) || stable;
    const reachSize = this.anchor.update(t, signal, s.gripperInput === "space" ? null : pinch, gripper);
    const raw = toHandPoseMsg(hand, frame, this.last, s, reachSize ?? undefined);
    this.last = raw;
    const control = raw.tracking_ok ? this.shaper.apply(raw.control, { gain: s.gain, clutch: input.clutch }) : this.sent?.control;
    const msg: HandPoseMsg = control ? { ...raw, control } : raw;
    this.sent = msg;
    return { msg, gripper, pinch, size3d, stable, reachSize: raw.tracking_ok ? reachSize : null, clutched: input.clutch };
  }
}
