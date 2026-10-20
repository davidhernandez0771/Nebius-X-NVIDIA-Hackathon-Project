import * as THREE from "three";
import { describe, expect, it } from "vitest";
import MARK from "../../../../public/world/mark.svg?raw";
import { logoShapes, strokeOutline } from "./logo3d";

/** The shoelace area of a closed polygon. */
const area = (pts: THREE.Vector2[]) => Math.abs(THREE.ShapeUtils.area(pts));

describe("strokeOutline", () => {
  it("outlines a straight stroke as a capsule: its length times its width, plus round caps", () => {
    const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(10, 0)];
    const out = strokeOutline(pts, 2);
    expect(area(out)).toBeCloseTo(10 * 2 + Math.PI, 1);
    const xs = out.map((p) => p.x);
    const ys = out.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(-1, 3);
    expect(Math.max(...xs)).toBeCloseTo(11, 3);
    expect(Math.min(...ys)).toBeCloseTo(-1, 3);
    expect(Math.max(...ys)).toBeCloseTo(1, 3);
  });

  it("follows a curve at half the width on both sides", () => {
    const pts = Array.from({ length: 33 }, (_, i) => {
      const a = (i / 32) * (Math.PI / 2);
      return new THREE.Vector2(Math.cos(a) * 10, Math.sin(a) * 10);
    });
    for (const p of strokeOutline(pts, 2)) {
      const r = p.length();
      // On the arc's band (9–11), or on a cap round one of its two ends.
      const nearEnd = Math.min(p.distanceTo(pts[0]), p.distanceTo(pts[32]));
      expect(r >= 8.99 && r <= 11.01 || nearEnd <= 1.001).toBe(true);
    }
  });
});

describe("logoShapes (the mark, from web/public/world/mark.svg)", () => {
  it("splits the mark into the ring (its arcs) and the core (the ticks and the diamond)", () => {
    const { ring, core } = logoShapes(MARK);
    expect(ring).toHaveLength(4);
    expect(core).toHaveLength(5);
  });

  it("centres it on the origin with the arcs at radius 1, y up", () => {
    const { ring, core } = logoShapes(MARK);
    for (const s of ring)
      for (const p of s.getPoints())
        // The arcs' centre line is at 1; the stroke is 22/128 wide.
        expect(Math.abs(p.length() - 1)).toBeLessThanOrEqual(11 / 128 + 1e-3);
    // The diamond is the core's only shape around the centre.
    const centre = core.filter((s) => s.getPoints().every((p) => p.length() < 0.25));
    expect(centre).toHaveLength(1);
    // SVG's y runs down; the shapes' y runs up: the arc through (376.7, 298.7) → (298.7, 376.7) is bottom right.
    const bottomRight = ring.filter((s) => s.getPoints().every((p) => p.x > 0 && p.y < 0));
    expect(bottomRight).toHaveLength(1);
  });
});
