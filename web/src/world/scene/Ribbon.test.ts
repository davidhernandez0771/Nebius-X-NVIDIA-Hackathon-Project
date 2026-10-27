import { describe, expect, it } from "vitest";
import { HELIX, SPARE } from "./layout";
import { EDGE_REACH, bandGeometry, ribbonCurve } from "./Ribbon";

describe("the spiral's band", () => {
  it("runs just under every cartridge's bottom edge (and every empty place's), rising all the way", () => {
    const pts = ribbonCurve().points;
    const places = HELIX.flatMap((h) => [h, ...SPARE.filter((p) => p.after === h.index)]);
    expect(pts).toHaveLength(HELIX.length + SPARE.length + 2);
    places.forEach((s, i) => {
      const p = pts[i + 1];
      expect(p.y).toBeLessThan(s.position[1] - 1.2);
      expect(p.y).toBeGreaterThan(s.position[1] - 1.35);
    });
    for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeGreaterThan(pts[i - 1].y);
  });
});

describe("the band's teal edge", () => {
  it("is a soft-edged line: the 5.5 cm lip, with room either side for the edge ramp", () => {
    const { edge } = bandGeometry(ribbonCurve());
    const across = edge.getAttribute("aAcross");
    const pos = edge.getAttribute("position");
    expect(across.count).toBe(pos.count);
    for (let i = 0; i < across.count; i += 2) {
      expect([across.getX(i), across.getX(i + 1)]).toEqual([-EDGE_REACH, EDGE_REACH]);
      // The strip is EDGE_REACH times the lip's height, so ±1 is the lip itself.
      const h = Math.hypot(pos.getX(i + 1) - pos.getX(i), pos.getY(i + 1) - pos.getY(i), pos.getZ(i + 1) - pos.getZ(i)) / EDGE_REACH;
      expect(h).toBeCloseTo(Math.hypot(0.055, 0.01), 4);
    }
  });
});
