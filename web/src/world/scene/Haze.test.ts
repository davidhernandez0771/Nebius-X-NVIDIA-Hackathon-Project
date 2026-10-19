import { describe, expect, it } from "vitest";
import { SHAFTS, dustPoints } from "./Haze";

describe("the haze", () => {
  it("keeps every mote inside its shaft and repeats the same dust every visit", () => {
    const s = SHAFTS[0];
    const a = dustPoints(s, 200, 1);
    expect(dustPoints(s, 200, 1).positions).toEqual(a.positions);
    for (let i = 0; i < 200; i++) {
      const [x, y, z] = [a.positions[i * 3], a.positions[i * 3 + 1], a.positions[i * 3 + 2]];
      expect(y).toBeLessThanOrEqual(s.top.y + 1e-6);
      expect(y).toBeGreaterThanOrEqual(s.floorY - 1e-6);
      const down = (s.top.y - y) / (s.top.y - s.floorY);
      expect(Math.hypot(x - s.top.x, z - s.top.z)).toBeLessThanOrEqual(s.topR + (s.bottomR - s.topR) * down + 1e-6);
    }
  });
});
