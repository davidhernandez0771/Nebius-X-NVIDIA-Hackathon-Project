import { describe, expect, it } from "vitest";
import { stop } from "../../scene/layout";
import { SKYLIGHT } from "../intro/layout";
import { CLOSED_FROM, CLOSED_TO, CUT_AT, cover, diveEnter } from "./dive";

const DESCENT_END = { position: [0, 20, 5] as const, target: [0, 7, 0] as const, fov: 40 };

describe("the dive into the workshop", () => {
  it("starts where the descent ends and lands on the Workshop intro stop", () => {
    expect(diveEnter(0, DESCENT_END)).toEqual(DESCENT_END);
    const end = diveEnter(1, DESCENT_END);
    const intro = stop("Workshop intro");
    end.position.forEach((v, i) => expect(v).toBeCloseTo(intro.position[i], 9));
    expect(end.fov).toBeCloseTo(intro.fov, 9);
  });

  it("never drops below the ceiling before the cut: the slab is never flown over", () => {
    for (let t = 0; t < CUT_AT; t += 0.01) expect(diveEnter(t, DESCENT_END).position[1]).toBeGreaterThan(SKYLIGHT.center[1] + 1);
  });

  it("cuts only while the frame is fully dark, and is open at both ends", () => {
    expect(cover(0)).toBe(0);
    expect(cover(1)).toBe(0);
    for (let t = CLOSED_FROM; t <= CLOSED_TO; t += 0.01) expect(cover(t)).toBeCloseTo(1, 9);
    expect(CUT_AT).toBeGreaterThan(CLOSED_FROM);
    expect(CUT_AT).toBeLessThan(CLOSED_TO);
  });
});
