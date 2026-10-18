// Calibrate pinch: two holds, open hand then pinch, each giving the median 3D pinch value
// (pinch.ts pinch3d). The thresholds then sit 35% and 65% of the way between them
// (pinchThresholds), so a user whose pinch never gets the tips together still closes the gripper.
// Live test #4: MediaPipe's world landmarks don't match the synthetic hands the defaults came from.

import type { PinchCal } from "./pinch";

export type PinchCalStep = "open" | "pinch" | "done" | "failed";

export interface PinchCalSample {
  t: number; // HandFrame.timestamp, ms
  value: number | null; // HandReadout.pinchValue; null without a hand or its world landmarks
}

export interface PinchCalState {
  step: PinchCalStep;
  progress: number; // 0..1 within the current step
  result?: PinchCal;
  error?: string;
}

export interface PinchCalOptions {
  settleMs: number; // time to get into the pose before the hold is measured
  holdMs: number;
}

export const PINCH_CAL_DEFAULTS: PinchCalOptions = { settleMs: 500, holdMs: 1500 };
const MIN_SAMPLES = 10;
const MIN_SPREAD = 0.15; // open must read at least this much above pinched

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class PinchCalibrator {
  private state: PinchCalState = { step: "open", progress: 0 };
  private stepStart: number | null = null;
  private values: number[] = [];
  private open = 0;

  constructor(private readonly opts: PinchCalOptions = PINCH_CAL_DEFAULTS) {}

  push(sample: PinchCalSample): PinchCalState {
    const step = this.state.step;
    if (step === "done" || step === "failed") return this.state;
    if (this.stepStart === null) this.stepStart = sample.t; // each step's clock starts at its first sample
    const elapsed = sample.t - this.stepStart;
    const total = this.opts.settleMs + this.opts.holdMs;
    if (sample.value !== null && elapsed >= this.opts.settleMs) this.values.push(sample.value);
    if (elapsed < total) return (this.state = { step, progress: elapsed / total });

    if (this.values.length < MIN_SAMPLES)
      return (this.state = { step: "failed", progress: 1, error: "Your hand wasn't seen during the hold. Keep it in view and try again." });
    const value = median(this.values);
    this.values = [];
    this.stepStart = null;
    if (step === "open") {
      this.open = value;
      return (this.state = { step: "pinch", progress: 0 });
    }
    if (this.open - value < MIN_SPREAD)
      return (this.state = {
        step: "failed",
        progress: 1,
        error: `Open and pinch read about the same (${this.open.toFixed(2)} and ${value.toFixed(2)}). Spread your thumb and index wide for open, and touch their tips for the pinch.`,
      });
    return (this.state = { step: "done", progress: 1, result: { open: this.open, pinched: value } });
  }
}
