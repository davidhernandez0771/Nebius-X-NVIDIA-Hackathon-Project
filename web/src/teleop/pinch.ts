// Live test #8: the gripper from the simplest pinch. Thumb tip and index tip together = closed.
//
// gap = |lm4 - lm8| / |lm0 - lm9|, both in image px: the 2D distance between the thumb and index
// tips over the hand's size (wrist to middle knuckle), so it doesn't change with the distance
// from the camera. No world landmarks, no calibration (the 3D pinch and Calibrate pinch of hand
// v3 are gone).
//
// PinchLatch closes on the first frame below PINCH_CLOSE_BELOW. It opens only after the gap has
// stayed above PINCH_OPEN_ABOVE (clearly apart) for PINCH_OPEN_HOLD_MS, so one noisy frame can
// never drop what the gripper holds. In between it holds. Nothing freezes it: no palm-angle or
// handedness gating (live test #4: MediaPipe's handedness is mirrored on the user's camera).

import type { HandLandmark } from "../hand/contracts";

export const PINCH_CLOSE_BELOW = 0.25; // tips about 2 cm apart on an adult hand
export const PINCH_OPEN_ABOVE = 0.5; // about 4.5 cm apart
export const PINCH_OPEN_HOLD_MS = 150;

/** The pinch gap for one hand, or null when the hand has no size. */
export function pinchGap(lm: readonly HandLandmark[], frameWidth: number, frameHeight: number): number | null {
  const px = (a: number, b: number) => Math.hypot((lm[a].x - lm[b].x) * frameWidth, (lm[a].y - lm[b].y) * frameHeight);
  const size = px(0, 9);
  if (!(size > 0)) return null;
  const v = px(4, 8) / size;
  return Number.isFinite(v) ? v : null;
}

export class PinchLatch {
  state: 0 | 1 = 0;
  private wideSince: number | null = null; // while closed: when the gap went (and stayed) wide

  /** gap: this frame's pinchGap, or null with no hand (holds). t: the frame's timestamp, ms. */
  update(gap: number | null, t: number): 0 | 1 {
    if (gap === null) {
      this.wideSince = null;
      return this.state;
    }
    if (gap < PINCH_CLOSE_BELOW) {
      this.state = 1;
      this.wideSince = null;
    } else if (gap > PINCH_OPEN_ABOVE && this.state === 1) {
      this.wideSince ??= t;
      if (t - this.wideSince >= PINCH_OPEN_HOLD_MS) {
        this.state = 0;
        this.wideSince = null;
      }
    } else {
      this.wideSince = null;
    }
    return this.state;
  }
}
