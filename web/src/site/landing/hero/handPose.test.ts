import { describe, expect, it } from "vitest";
import { handPose, solveTwoLink, PINCH_TIP_GAP } from "./handPose";

const at = { x: 500, y: 400, scale: 100, angle: 0 };
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("solveTwoLink", () => {
  it("reaches a target inside its range", () => {
    const base = { x: 0, y: 0 };
    const target = { x: 0.4, y: 0.2 };
    const { mid, end } = solveTwoLink(base, target, 0.3, 0.25, 1);
    expect(dist(base, mid)).toBeCloseTo(0.3, 6);
    expect(dist(mid, end)).toBeCloseTo(0.25, 6);
    expect(dist(end, target)).toBeLessThan(1e-6);
  });

  it("stretches toward a target out of range without breaking the bone lengths", () => {
    const { mid, end } = solveTwoLink({ x: 0, y: 0 }, { x: 2, y: 0 }, 0.3, 0.25, 1);
    expect(dist({ x: 0, y: 0 }, mid)).toBeCloseTo(0.3, 6);
    expect(dist(mid, end)).toBeCloseTo(0.25, 6);
    expect(end.x).toBeCloseTo(0.55, 6);
  });
});

describe("handPose", () => {
  it("returns the 21 hand-tracking landmarks with the wrist where asked", () => {
    const pts = handPose({ ...at, pinch: 0 });
    expect(pts).toHaveLength(21);
    expect(pts[0].x).toBeCloseTo(500, 6);
    expect(pts[0].y).toBeCloseTo(400, 6);
  });

  it("closes the thumb tip onto the index tip at a full pinch", () => {
    const open = handPose({ ...at, pinch: 0 });
    const shut = handPose({ ...at, pinch: 1 });
    expect(dist(open[4], open[8])).toBeGreaterThan(0.5 * at.scale);
    expect(dist(shut[4], shut[8])).toBeCloseTo(PINCH_TIP_GAP * at.scale, 1);
  });

  it("narrows the gap steadily as the pinch closes", () => {
    const gaps = [0, 0.25, 0.5, 0.75, 1].map((p) => {
      const pts = handPose({ ...at, pinch: p });
      return dist(pts[4], pts[8]);
    });
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
  });

  it("scales and rotates rigidly about the wrist", () => {
    const a = handPose({ ...at, pinch: 0.3 });
    const b = handPose({ ...at, pinch: 0.3, scale: 200, angle: Math.PI / 2 });
    // Index tip: twice as far from the wrist, turned a quarter.
    const va = { x: a[8].x - 500, y: a[8].y - 400 };
    const vb = { x: b[8].x - 500, y: b[8].y - 400 };
    expect(vb.x).toBeCloseTo(-2 * va.y, 4);
    expect(vb.y).toBeCloseTo(2 * va.x, 4);
  });

  it("mirrors across its own axis", () => {
    const a = handPose({ ...at, pinch: 0.4 });
    const b = handPose({ ...at, pinch: 0.4, mirror: true });
    a.forEach((p, i) => {
      expect(b[i].x).toBeCloseTo(p.x, 6);
      expect(b[i].y - 400).toBeCloseTo(-(p.y - 400), 6);
    });
  });
});
