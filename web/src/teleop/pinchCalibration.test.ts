import { describe, expect, it } from "vitest";

import { PINCH_CAL_DEFAULTS, PinchCalibrator, type PinchCalState } from "./pinchCalibration";

const { settleMs, holdMs } = PINCH_CAL_DEFAULTS;
const STEP_MS = settleMs + holdMs;

/** Feeds `value(t)` every 33 ms for `ms`, from t0; returns the last state. */
function feed(c: PinchCalibrator, t0: number, ms: number, value: (t: number) => number | null): PinchCalState {
  let s: PinchCalState = { step: "open", progress: 0 };
  for (let t = t0; t <= t0 + ms; t += 33) s = c.push({ t, value: value(t - t0) });
  return s;
}

describe("PinchCalibrator: hold open, then hold a pinch", () => {
  it("takes the median of each hold as the open and pinched values", () => {
    const c = new PinchCalibrator();
    let s = feed(c, 0, STEP_MS + 40, (t) => (t % 2 ? 1.1 : 1.3));
    expect(s.step).toBe("pinch");
    s = feed(c, 5000, STEP_MS + 40, () => 0.3);
    expect(s.step).toBe("done");
    expect(s.result!.pinched).toBeCloseTo(0.3, 9);
    expect(s.result!.open).toBeGreaterThanOrEqual(1.1);
    expect(s.result!.open).toBeLessThanOrEqual(1.3);
  });

  it("ignores the settle time, while the hand gets into position", () => {
    const c = new PinchCalibrator();
    feed(c, 0, STEP_MS + 40, () => 1.2);
    // The first settleMs of the pinch step still reads open; only the hold counts.
    const s = feed(c, 5000, STEP_MS + 40, (t) => (t < settleMs ? 1.2 : 0.25));
    expect(s.result).toEqual({ open: 1.2, pinched: 0.25 });
  });

  it("reports progress through each step, the clock starting at the step's first sample", () => {
    const c = new PinchCalibrator();
    expect(c.push({ t: 10_000, value: 1 }).progress).toBe(0);
    const half = c.push({ t: 10_000 + STEP_MS / 2, value: 1 });
    expect(half.step).toBe("open");
    expect(half.progress).toBeCloseTo(0.5, 6);
  });

  it("fails when the hand (or its 3D landmarks) isn't seen during a hold", () => {
    const c = new PinchCalibrator();
    const s = feed(c, 0, STEP_MS + 40, () => null);
    expect(s.step).toBe("failed");
    expect(s.error).toMatch(/hand/i);
  });

  it("fails when open and pinch read about the same", () => {
    const c = new PinchCalibrator();
    feed(c, 0, STEP_MS + 40, () => 0.7);
    const s = feed(c, 5000, STEP_MS + 40, () => 0.62);
    expect(s.step).toBe("failed");
    expect(s.error).toMatch(/about the same/i);
  });

  it("stays finished: later samples change nothing", () => {
    const c = new PinchCalibrator();
    feed(c, 0, STEP_MS + 40, () => 1.2);
    const done = feed(c, 5000, STEP_MS + 40, () => 0.2);
    expect(c.push({ t: 9000, value: 5 })).toEqual(done);
  });
});
