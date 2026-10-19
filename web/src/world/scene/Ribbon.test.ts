import { describe, expect, it } from "vitest";
import { HELIX } from "./layout";
import { ribbonCurve } from "./Ribbon";

describe("the spiral's band", () => {
  it("runs just under every cartridge's bottom edge, rising all the way", () => {
    const pts = ribbonCurve().points;
    expect(pts).toHaveLength(HELIX.length + 2);
    HELIX.forEach((s, i) => {
      const p = pts[i + 1];
      expect(p.y).toBeLessThan(s.position[1] - 1.2);
      expect(p.y).toBeGreaterThan(s.position[1] - 1.35);
    });
    for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeGreaterThan(pts[i - 1].y);
  });
});
