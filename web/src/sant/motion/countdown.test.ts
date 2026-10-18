import { describe, expect, it } from "vitest";
import { DOT_COLS, DOT_ROWS, countdownSteps, digitDots } from "./countdown";

describe("digitDots", () => {
  it("draws each digit on the same 5 × 7 grid", () => {
    for (const d of "0123456789") {
      const dots = digitDots(d);
      expect(dots).toHaveLength(DOT_COLS * DOT_ROWS);
      expect(dots.some(Boolean)).toBe(true);
    }
  });

  it("draws every digit differently", () => {
    const shapes = new Set("0123456789".split("").map((d) => digitDots(d).map(Number).join("")));
    expect(shapes.size).toBe(10);
  });

  it("draws a 1 as a vertical stroke down the middle column", () => {
    const one = digitDots("1");
    for (let r = 0; r < DOT_ROWS; r++) expect(one[r * DOT_COLS + 2]).toBe(true);
  });
});

describe("countdownSteps", () => {
  it("counts down to 1", () => {
    expect(countdownSteps(3)).toEqual([3, 2, 1]);
    expect(countdownSteps(5)).toEqual([5, 4, 3, 2, 1]);
  });
});
