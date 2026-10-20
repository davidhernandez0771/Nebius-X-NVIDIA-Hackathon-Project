import { describe, expect, it } from "vitest";
import { MotionShaper, SENSITIVITY_MAX, SENSITIVITY_MIN } from "./motionShaper";

type C = [number, number, number];
const run = (m: MotionShaper, raws: C[], opts: { gain?: number; clutch?: boolean }[]) => raws.map((r, i) => m.apply(r, { gain: opts[i]?.gain ?? 1, clutch: opts[i]?.clutch ?? false }));

describe("MotionShaper", () => {
  it("passes the control through at sensitivity 1", () => {
    expect(new MotionShaper().apply([0.3, 0.6, 0.5], { gain: 1, clutch: false })).toEqual([0.3, 0.6, 0.5]);
  });

  it("scales motion about the middle of the region at a higher sensitivity, clamped to [0, 1]", () => {
    const m = new MotionShaper();
    const out = m.apply([0.6, 0.4, 0.75], { gain: 2, clutch: false })!;
    expect(out[0]).toBeCloseTo(0.7);
    expect(out[1]).toBeCloseTo(0.3);
    expect(out[2]).toBeCloseTo(1);
  });

  it("changing the sensitivity doesn't move the arm; only motion after it is scaled", () => {
    const m = new MotionShaper();
    const [a, b, c] = run(m, [[0.6, 0.5, 0.5], [0.6, 0.5, 0.5], [0.65, 0.5, 0.5]], [{ gain: 1 }, { gain: 2 }, { gain: 2 }]);
    expect(b![0]).toBeCloseTo(a![0]);
    expect(c![0] - b![0]).toBeCloseTo(0.1);
  });

  it("the clutch freezes the output and lets go without a jump", () => {
    const m = new MotionShaper();
    const outs = run(
      m,
      [[0.5, 0.5, 0.5], [0.4, 0.5, 0.5], [0.2, 0.5, 0.5], [0.2, 0.5, 0.5], [0.25, 0.5, 0.5]],
      [{}, { clutch: true }, { clutch: true }, {}, {}],
    );
    expect(outs[1]).toEqual(outs[0]);
    expect(outs[2]).toEqual(outs[0]);
    expect(outs[3]![0]).toBeCloseTo(0.5); // released where it was
    expect(outs[4]![0]).toBeCloseTo(0.55); // then relative to the new hand position
    expect(m.clutched).toBe(false);
  });

  it("passes no control through (no control region) and keeps its state", () => {
    const m = new MotionShaper();
    expect(m.apply(undefined, { gain: 2, clutch: false })).toBeUndefined();
  });

  it("has a sensible range", () => {
    expect(SENSITIVITY_MIN).toBeGreaterThan(0);
    expect(SENSITIVITY_MIN).toBeLessThan(1);
    expect(SENSITIVITY_MAX).toBeGreaterThanOrEqual(2);
  });
});
