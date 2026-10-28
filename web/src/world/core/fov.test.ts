import { describe, expect, it } from "vitest";
import { fitFov, MAX_FOV } from "./fov";

const hfov = (vfov: number, aspect: number) => (2 * Math.atan(Math.tan((vfov * Math.PI) / 360) * aspect) * 180) / Math.PI;

describe("fitFov", () => {
  it("leaves landscape and square screens alone", () => {
    expect(fitFov(40, 16 / 9)).toBe(40);
    expect(fitFov(40, 1)).toBe(40);
  });

  it("widens a portrait screen so it sees as much across as a square one", () => {
    const f = fitFov(40, 0.75);
    expect(f).toBeGreaterThan(40);
    expect(hfov(f, 0.75)).toBeCloseTo(hfov(40, 1), 6);
  });

  it("never goes past MAX_FOV, however narrow", () => {
    expect(fitFov(40, 0.2)).toBe(MAX_FOV);
    expect(fitFov(70, 0.46)).toBeLessThanOrEqual(MAX_FOV);
  });
});
