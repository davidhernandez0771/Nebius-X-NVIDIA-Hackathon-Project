import { describe, expect, it } from "vitest";
import { createWorldStore } from "../../core/store";
import { STATIONS } from "..";
import { nextY, snapY, stepGeometry } from "./stepper";

const store = createWorldStore(STATIONS, 1000);

describe("the spiral's stepper", () => {
  const g = stepGeometry(store, 23)!;

  it("moves exactly one step per notch inside the steps", () => {
    expect(nextY(g, g.yOfStep(5), 1, false)).toBeCloseTo(g.yOfStep(6), 6);
    expect(nextY(g, g.yOfStep(5) + 20, -1, false)).toBeCloseTo(g.yOfStep(4), 6);
  });

  it("lets the page scroll on past the ends, except down past the last match with a filter", () => {
    expect(nextY(g, g.yOfStep(0), -1, false)).toBeNull();
    expect(nextY(g, g.yOfStep(23), 1, false)).toBeNull();
    const f = stepGeometry(store, 3)!;
    expect(nextY(f, f.yOfStep(3), 1, true)).toBeCloseTo(f.yOfStep(3), 6);
    expect(nextY(g, g.yOfStep(0) - 3 * g.half, 1, false)).toBeNull();
  });

  it("snaps a stopped scroll to the nearest step, and back to the last match with a filter", () => {
    expect(snapY(g, g.yOfStep(7) + g.half * 1.2, false)).toBeCloseTo(g.yOfStep(8), 6);
    const f = stepGeometry(store, 3)!;
    expect(snapY(f, f.yOfStep(3) + 2 * f.half, true)).toBeCloseTo(f.yOfStep(3), 6);
    expect(snapY(g, g.yOfStep(0) - 2 * g.half, false)).toBeNull();
  });
});
