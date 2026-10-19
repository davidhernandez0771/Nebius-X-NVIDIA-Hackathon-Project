import { describe, expect, it } from "vitest";
import { N_ITEMS, stepPose } from "../../scene/spiral";
import { detailView, stepOfT, stepView, tOfStep, workshopCamera } from "./camera";

describe("the workshop's camera", () => {
  it("maps steps to t and back, the last step at the end of the dwell", () => {
    for (const d of [0, 3, 11.5, N_ITEMS - 1]) expect(stepOfT(tOfStep(d))).toBeCloseTo(d, 9);
    expect(tOfStep(N_ITEMS - 1)).toBeCloseTo(1, 9);
    expect(workshopCamera(1)).toEqual(stepView(N_ITEMS - 1));
  });

  it("faces each cartridge from outside, inside the room, and closer in the detail view", () => {
    for (let d = 0; d < N_ITEMS; d++) {
      const v = stepView(d);
      const c = stepPose(d).position;
      const r = (p: readonly number[]) => Math.hypot(p[0], p[2]);
      expect(r(v.position)).toBeGreaterThan(Math.hypot(c.x, c.z) + 3);
      expect(v.position[1]).toBeLessThan(14.4);
      expect(Math.abs(v.position[0])).toBeLessThan(22);
      expect(v.position[2]).toBeLessThan(13);
      const far = Math.hypot(v.position[0] - c.x, v.position[2] - c.z);
      const near = detailView(d);
      expect(Math.hypot(near.position[0] - c.x, near.position[2] - c.z)).toBeLessThan(far);
    }
  });
});
