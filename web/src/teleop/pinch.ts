// Hand v3: the gripper from the thumb-index pinch, in 3D when MediaPipe gives world landmarks.
//
// pinch = |wl4 - wl8| / (|wl5 - wl6| + |wl6 - wl7| + |wl7 - wl8|): thumb tip to index tip over the
// index finger's own length, so it doesn't change with distance or with how the hand is turned.
// Without world landmarks it falls back to the 2D pinch_ratio (|lm4 - lm8| px / palm width px)
// with the sim's own GripperLatch thresholds.
//
// PinchLatch keeps GripperLatch's hysteresis and needs CHANGE_FRAMES frames in a row to change
// state. Nothing freezes it: no palm-angle or handedness gating (live test #4: MediaPipe's
// handedness is mirrored on the user's camera, and gating on it froze the normal pose).

import type { HandLandmark, TrackedHand } from "../hand/contracts";

export type PinchSource = "3d" | "2d";

export interface PinchReading {
  value: number;
  source: PinchSource;
}

/** A Calibrate pinch result: the median 3D pinch with the hand open, and pinched. */
export interface PinchCal {
  open: number;
  pinched: number;
}

export interface PinchThresholds {
  closeBelow: number;
  openAbove: number;
}

// Never calibrated: an open, relaxed hand reads about 1 index-finger length; MediaPipe's pinch
// rarely gets the tips fully together, so about 0.2. Calibrate pinch replaces these.
export const DEFAULT_PINCH_CAL: PinchCal = { open: 1.0, pinched: 0.2 };
// The 2D fallback: the sim's GripperLatch defaults (src/demo_pipeline/teleop.py).
export const PINCH_2D: PinchThresholds = { closeBelow: 0.35, openAbove: 0.45 };
export const CHANGE_FRAMES = 2;
const CLOSE_AT = 0.35; // of the way from pinched to open
const OPEN_AT = 0.65;

const dist = (a: HandLandmark, b: HandLandmark): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** The 3D pinch, or null when the index finger has no length. */
export function pinch3d(world: readonly HandLandmark[]): number | null {
  const len = dist(world[5], world[6]) + dist(world[6], world[7]) + dist(world[7], world[8]);
  if (!(len > 0)) return null;
  const v = dist(world[4], world[8]) / len;
  return Number.isFinite(v) ? v : null;
}

/** The pinch for a tracked hand: 3D from its world landmarks, else the message's 2D pinch_ratio. */
export function readPinch(hand: TrackedHand, pinchRatio2d: number): PinchReading {
  const world = hand.worldLandmarks;
  const v = world && world.length >= 21 ? pinch3d(world) : null;
  return v !== null ? { value: v, source: "3d" } : { value: pinchRatio2d, source: "2d" };
}

/** The 3D hysteresis band for a calibration (null: DEFAULT_PINCH_CAL). */
export function pinchThresholds(cal: PinchCal | null): PinchThresholds {
  const { open, pinched } = cal ?? DEFAULT_PINCH_CAL;
  return { closeBelow: round3(pinched + CLOSE_AT * (open - pinched)), openAbove: round3(pinched + OPEN_AT * (open - pinched)) };
}

export class PinchLatch {
  state: 0 | 1 = 0;
  private streak = 0;

  /** reading: this frame's pinch, or null with no hand (holds). thresholds3d: for 3D readings. */
  update(reading: PinchReading | null, thresholds3d: PinchThresholds): 0 | 1 {
    if (!reading) {
      this.streak = 0;
      return this.state;
    }
    const t = reading.source === "3d" ? thresholds3d : PINCH_2D;
    const want: 0 | 1 = reading.value < t.closeBelow ? 1 : reading.value > t.openAbove ? 0 : this.state;
    if (want === this.state) this.streak = 0;
    else if (++this.streak >= CHANGE_FRAMES) {
      this.state = want;
      this.streak = 0;
    }
    return this.state;
  }
}
