import { describe, expect, it } from "vitest";
import { LIFT_H, LIFT_S, liftOffset, liftOfPlug, stepLift } from "./lift";
import { HELIX } from "./layout";

describe("the spiral's lift", () => {
  it("takes every cartridge and the band above the ceiling (14.4 m)", () => {
    const lowest = Math.min(...HELIX.map((s) => s.position[1] - 1.25));
    expect(lowest + liftOffset(1)).toBeGreaterThan(14.4 + 1);
    expect(liftOffset(0)).toBe(0);
    expect(liftOffset(1)).toBe(LIFT_H);
  });

  it("goes up and down at its pace, or at once with reduced motion", () => {
    let l = 0;
    for (let t = 0; t < LIFT_S - 1e-9; t += 1 / 60) l = stepLift(l, 1, 1 / 60);
    expect(l).toBeGreaterThan(0.95);
    expect(stepLift(l, 1, 1)).toBe(1);
    expect(stepLift(1, 0, 1 / 60)).toBeLessThan(1);
    expect(stepLift(1, 0, 1 / 60, true)).toBe(0);
  });

  it("follows the plug-in: up between up[0] and up[1], down between down[0] and down[1]", () => {
    const up = [0.2, 0.4] as const;
    const down = [0.8, 0.9] as const;
    expect(liftOfPlug(0.1, up, down, false)).toBe(0);
    expect(liftOfPlug(0.3, up, down, false)).toBeCloseTo(0.5, 9);
    expect(liftOfPlug(0.6, up, down, false)).toBe(1);
    expect(liftOfPlug(0.85, up, down, false)).toBeCloseTo(0.5, 9);
    expect(liftOfPlug(0.95, up, down, false)).toBe(0);
    expect(liftOfPlug(0.1, up, down, true)).toBe(1);
  });
});
