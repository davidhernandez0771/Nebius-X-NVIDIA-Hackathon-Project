import { describe, expect, it } from "vitest";
import { crackHalfWidth, crackLocal, inCrack, shafts, trees } from "./forestPlan";
import { CRACK, FOREST } from "./layout";
import { walkXZ } from "./path";

const walk = walkXZ();
const toWalk = (x: number, z: number) => Math.min(...walk.map(([a, b]) => Math.hypot(a - x, b - z)));
const fromCenter = (x: number, z: number) => Math.hypot(x - FOREST.center[0], z - FOREST.center[1]);

describe("the crack", () => {
  it("is a jagged lens: widest near the middle, closed at both ends", () => {
    expect(crackHalfWidth(0)).toBeGreaterThan(CRACK.halfWidth * 0.9);
    expect(crackHalfWidth(CRACK.halfLength)).toBe(0);
    expect(crackHalfWidth(-CRACK.halfLength)).toBe(0);
    expect(crackHalfWidth(CRACK.halfLength * 1.2)).toBe(0);
    for (let u = -CRACK.halfLength; u <= CRACK.halfLength; u += 0.1) expect(crackHalfWidth(u)).toBeLessThan(CRACK.halfWidth * 1.4);
  });

  it("contains its centre, not the ground beside it, and a margin shrinks it", () => {
    const [cx, cz] = CRACK.center;
    expect(inCrack(cx, cz)).toBe(true);
    expect(inCrack(cx, cz, 1)).toBe(true);
    // Straight across the crack (its local v axis), past the edge.
    const across = (d: number): [number, number] => [cx + Math.sin(CRACK.angle) * d, cz + Math.cos(CRACK.angle) * d];
    expect(crackLocal(...across(1))).toEqual([expect.closeTo(0, 9), expect.closeTo(1, 9)]);
    expect(inCrack(...across(CRACK.halfWidth * 1.5))).toBe(false);
    expect(inCrack(...across(crackHalfWidth(0) - 0.1))).toBe(true);
    expect(inCrack(...across(crackHalfWidth(0) - 0.1), 0.5)).toBe(false);
  });
});

describe("the trees", () => {
  const t = trees(140, 7, walk);

  it("are the same every visit", () => {
    expect(trees(140, 7, walk)).toEqual(t);
    expect(t).toHaveLength(140);
  });

  it("stand in the forest, clear of the camera's way, the crack and each other", () => {
    for (const a of t) {
      expect(fromCenter(a.x, a.z)).toBeLessThan(FOREST.radius);
      expect(toWalk(a.x, a.z)).toBeGreaterThan(a.radius + 1.6);
      expect(inCrack(a.x, a.z, -2.5)).toBe(false);
      expect(a.height).toBeGreaterThan(FOREST.canopy * 0.8);
    }
    for (let i = 0; i < t.length; i++)
      for (let j = i + 1; j < t.length; j++) expect(Math.hypot(t[i].x - t[j].x, t[i].z - t[j].z)).toBeGreaterThan(t[i].radius + t[j].radius + 0.5);
  });

  it("crowd round the clearing: some close enough to frame the walk", () => {
    expect(t.filter((a) => toWalk(a.x, a.z) < 8).length).toBeGreaterThan(10);
  });
});

describe("the light shafts", () => {
  it("fall near the walk, through the gaps between the trunks", () => {
    const t = trees(140, 7, walk);
    const s = shafts(3, walk, t, 8);
    expect(s).toHaveLength(8);
    for (const q of s) {
      expect(toWalk(q.x, q.z)).toBeGreaterThan(2);
      expect(toWalk(q.x, q.z)).toBeLessThan(16);
      for (const a of t) expect(Math.hypot(a.x - q.x, a.z - q.z)).toBeGreaterThan(a.radius + q.radius * 0.5);
    }
  });
});
