import { describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import { obbFromMatrix, obbOverlap } from "./obb";

describe("obbFromMatrix", () => {
  it("puts the box centre at the matrix translation", () => {
    const m = new Matrix4().makeTranslation(1, 2, 3);
    const o = obbFromMatrix(m, [1, 2, 3]);
    expect(o.center.toArray()).toEqual([1, 2, 3]);
    expect(o.half).toEqual([1, 2, 3]);
  });

  it("offsets the centre by a local offset through the rotation", () => {
    const m = new Matrix4().makeRotationZ(Math.PI / 2);
    const o = obbFromMatrix(m, [1, 1, 1], new Vector3(1, 0, 0));
    expect(o.center.x).toBeCloseTo(0);
    expect(o.center.y).toBeCloseTo(1);
  });
});

describe("obbOverlap", () => {
  const at = (x: number, y: number, z: number, rz = 0, half: [number, number, number] = [1, 1, 1]) =>
    obbFromMatrix(new Matrix4().makeRotationZ(rz).setPosition(x, y, z), half);

  it("sees two separated axis-aligned boxes as clear", () => {
    expect(obbOverlap(at(0, 0, 0), at(2.5, 0, 0))).toBe(false);
  });

  it("sees two interpenetrating boxes as overlapping", () => {
    expect(obbOverlap(at(0, 0, 0), at(1.5, 0.5, 0))).toBe(true);
  });

  it("catches a corner poking in after a 45° turn", () => {
    // Centre gap 2.3 clears two axis-aligned unit boxes, but a 45° corner reaches 1 + √2 ≈ 2.41.
    expect(obbOverlap(at(0, 0, 0), at(2.3, 0, 0))).toBe(false);
    expect(obbOverlap(at(0, 0, 0), at(2.3, 0, 0, Math.PI / 4))).toBe(true);
  });

  it("finds a gap that only an edge-edge axis shows", () => {
    // Two unit cubes, each turned 45° so an edge faces the other: A's edge runs along z, B's along y.
    // They clear along x (2 × 0.707 < 1.45), which is no face normal of either box.
    const a = obbFromMatrix(new Matrix4().makeRotationZ(Math.PI / 4), [0.5, 0.5, 0.5]);
    const b = obbFromMatrix(new Matrix4().makeRotationY(Math.PI / 4).setPosition(1.45, 0, 0), [0.5, 0.5, 0.5]);
    expect(obbOverlap(a, b)).toBe(false);
    const c = obbFromMatrix(new Matrix4().makeRotationY(Math.PI / 4).setPosition(1.35, 0, 0), [0.5, 0.5, 0.5]);
    expect(obbOverlap(a, c)).toBe(true);
  });

  it("treats the margin as extra clearance", () => {
    expect(obbOverlap(at(0, 0, 0), at(2.1, 0, 0))).toBe(false);
    expect(obbOverlap(at(0, 0, 0), at(2.1, 0, 0), 0.2)).toBe(true);
  });
});
