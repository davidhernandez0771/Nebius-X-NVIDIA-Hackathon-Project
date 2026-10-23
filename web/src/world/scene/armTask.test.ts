import { describe, expect, it } from "vitest";
import { GAP_PUSH, GAP_REACH, gapShift } from "./armTask";

const open = (yaw: number, y0: number, y1: number) => ({ level: 1, yaw, y0, y1 });

describe("the spiral's opening for the arm", () => {
  it("is shut until the arm opens it", () => {
    expect(gapShift(0.1, 5, { level: 0, yaw: 0, y0: 4, y1: 6 })).toBe(0);
  });

  it("moves the cartridges round the opening aside, away from it, most at its middle", () => {
    const g = open(1, 4, 6);
    const left = gapShift(0.8, 5, g);
    const right = gapShift(1.2, 5, g);
    expect(left).toBeLessThan(0);
    expect(right).toBeGreaterThan(0);
    expect(Math.abs(gapShift(0.95, 5, g))).toBeGreaterThan(Math.abs(gapShift(0.5, 5, g)));
    expect(Math.abs(left)).toBeLessThanOrEqual(GAP_PUSH);
  });

  it("leaves the rest of the spiral where it is: round the side, and well above or below", () => {
    const g = open(0, 4, 6);
    expect(gapShift(GAP_REACH + 0.01, 5, g)).toBe(0);
    expect(gapShift(0.2, 12, g)).toBe(0);
    expect(gapShift(0.2, 0, g)).toBe(0);
  });

  it("opens the wrap-around way past ±180°", () => {
    const g = open(Math.PI - 0.05, 4, 6);
    expect(gapShift(-Math.PI + 0.1, 5, g)).toBeGreaterThan(0);
  });

  it("parts a slot's neighbours visibly as its cartridge comes out", () => {
    // Neighbours along the helix stand ~0.75 rad round, edge to edge with it.
    const g = open(0, 5, 5);
    expect(gapShift(0.75, 5.4, g)).toBeGreaterThan(0.08);
    expect(gapShift(-0.75, 4.6, g)).toBeLessThan(-0.08);
  });
});
