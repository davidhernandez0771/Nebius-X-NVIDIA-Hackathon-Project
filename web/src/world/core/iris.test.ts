import { describe, expect, it } from "vitest";
import { IRIS, IRIS_TOTAL_MS, irisRadius } from "./iris";

describe("the journey rail's iris", () => {
  it("starts and ends fully open, and is shut while the cut happens", () => {
    expect(irisRadius(0)).toBe(IRIS.openR);
    expect(irisRadius(IRIS_TOTAL_MS)).toBe(IRIS.openR);
    for (let ms = IRIS.closeMs; ms < IRIS.closeMs + IRIS.holdMs; ms += 10) expect(irisRadius(ms)).toBe(0);
  });

  it("only closes, then only opens", () => {
    let last = Infinity;
    for (let ms = 0; ms <= IRIS.closeMs; ms += 5) {
      expect(irisRadius(ms)).toBeLessThanOrEqual(last);
      last = irisRadius(ms);
    }
    last = 0;
    for (let ms = IRIS.closeMs + IRIS.holdMs; ms <= IRIS_TOTAL_MS; ms += 5) {
      expect(irisRadius(ms)).toBeGreaterThanOrEqual(last);
      last = irisRadius(ms);
    }
  });
});
