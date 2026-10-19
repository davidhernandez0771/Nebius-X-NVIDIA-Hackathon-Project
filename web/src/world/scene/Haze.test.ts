import { describe, expect, it } from "vitest";
import { SHAFTS } from "./Haze";

describe("the haze", () => {
  it("hangs each shaft from above the floor and widens it toward the floor", () => {
    for (const s of SHAFTS) {
      expect(s.top.y).toBeGreaterThan(s.floorY);
      expect(s.top.y).toBeLessThanOrEqual(14.4);
      expect(s.strength).toBeGreaterThan(0);
    }
  });
});
