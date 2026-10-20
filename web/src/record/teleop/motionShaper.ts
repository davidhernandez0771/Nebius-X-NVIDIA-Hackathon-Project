// Sensitivity and the clutch (live test after #10: "the arm gets tired"), applied to HandPoseMsg.control.
//
// Sensitivity is a gain about the middle of the control region: at 2, half the hand motion covers the same reach.
// The clutch works like lifting a mouse off the desk: while it is held the output stays where it was, whatever the
// hand does; when it is let go, an offset makes the output continue from there, so the arm moves relative to the
// hand's new position with no jump. A change of sensitivity re-anchors the same way, so moving the slider never
// moves the arm. Every axis is clamped to [0, 1], the region's range.

import { GAIN_MAX, GAIN_MIN } from "./controlRegion";

export const SENSITIVITY_MIN = GAIN_MIN;
export const SENSITIVITY_MAX = GAIN_MAX;

type C = [number, number, number];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class MotionShaper {
  private offset: C = [0, 0, 0];
  private gain = 1;
  private frozen: C | null = null;
  private last: C | null = null;

  get clutched(): boolean {
    return this.frozen !== null;
  }

  /** raw: this frame's control from the region (undefined: none is sent). Returns the control to send. */
  apply(raw: C | undefined, { gain, clutch }: { gain: number; clutch: boolean }): C | undefined {
    if (!raw) return undefined;
    const scaled = raw.map((v) => 0.5 + gain * (v - 0.5)) as C;
    if (gain !== this.gain) {
      if (this.last) this.offset = this.last.map((v, k) => v - scaled[k]) as C;
      this.gain = gain;
    }
    if (clutch) {
      this.frozen ??= this.last ?? (scaled.map((v, k) => clamp01(v + this.offset[k])) as C);
      return [...this.frozen];
    }
    if (this.frozen) {
      this.offset = this.frozen.map((v, k) => v - scaled[k]) as C;
      this.frozen = null;
    }
    this.last = scaled.map((v, k) => clamp01(v + this.offset[k])) as C;
    return [...this.last];
  }
}
