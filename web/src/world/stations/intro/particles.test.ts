import { describe, expect, it } from "vitest";
import { DUST } from "./layout";
import { dustBuffers, seeded } from "./particles";

describe("seeded", () => {
  it("repeats for a seed and stays in 0–1", () => {
    const a = seeded(4);
    const b = seeded(4);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("dustBuffers", () => {
  it("fills the column", () => {
    const d = dustBuffers(1000);
    for (let i = 0; i < 1000; i++) {
      expect(Math.hypot(d.position[i * 3], d.position[i * 3 + 2])).toBeLessThanOrEqual(DUST.radius);
      expect(d.position[i * 3 + 1]).toBeGreaterThanOrEqual(DUST.y0);
      expect(d.position[i * 3 + 1]).toBeLessThanOrEqual(DUST.y0 + DUST.height);
    }
  });
});
