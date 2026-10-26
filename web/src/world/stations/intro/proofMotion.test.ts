import { describe, expect, it } from "vitest";
import { barGrow, curveReached, stepLight, tallyCount, TALLY_ROWS } from "./proofMotion";

const steps = (n: number) => Array.from({ length: n + 1 }, (_, j) => j / n);

describe("the proof beats' graphs, as a share of the scroll drawn", () => {
  it("light the pipeline's steps one after another, all of them at the end, none at the start", () => {
    const n = 5;
    for (let i = 0; i < n; i++) {
      expect(stepLight(0, i, n)).toBe(0);
      expect(stepLight(1, i, n)).toBe(1);
      let prev = 0;
      for (const d of steps(100)) {
        expect(stepLight(d, i, n)).toBeGreaterThanOrEqual(prev);
        prev = stepLight(d, i, n);
      }
    }
    // In order: when step 2 is whole, step 3 has not started.
    expect(stepLight(3 / 5, 2, n)).toBe(1);
    expect(stepLight(3 / 5, 3, n)).toBe(0);
  });

  it("grow the climb's bars staggered, in order, each whole at the end", () => {
    const n = 4;
    for (let i = 0; i < n; i++) {
      expect(barGrow(0, i, n)).toBe(0);
      expect(barGrow(1, i, n)).toBe(1);
    }
    for (const d of steps(100)) for (let i = 1; i < n; i++) expect(barGrow(d, i, n)).toBeLessThanOrEqual(barGrow(d, i - 1, n));
    // The first is well on its way before the last starts.
    expect(barGrow(0.3, 0, n)).toBeGreaterThan(0.5);
    expect(barGrow(0.3, n - 1, n)).toBe(0);
  });

  it("read out the last checkpoint the curve has reached (never an in-between number)", () => {
    const xs = [0, 0.25, 0.5, 0.75, 1];
    expect(curveReached(0, xs)).toBe(0);
    expect(curveReached(0.2, xs)).toBe(0);
    expect(curveReached(0.25, xs)).toBe(1);
    expect(curveReached(0.99, xs)).toBe(3);
    expect(curveReached(1, xs)).toBe(4);
  });

  it("fill the gate's tallies one row after the other: before, then after", () => {
    const n = 50;
    expect(TALLY_ROWS).toBe(2);
    expect(tallyCount(0, 0, n)).toBe(0);
    expect(tallyCount(1, 0, n)).toBe(n);
    expect(tallyCount(1, 1, n)).toBe(n);
    for (const d of steps(200)) {
      if (tallyCount(d, 1, n) > 0) expect(tallyCount(d, 0, n)).toBe(n);
      expect(Number.isInteger(tallyCount(d, 0, n))).toBe(true);
    }
  });
});
