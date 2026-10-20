import { describe, expect, it } from "vitest";
import { farTrees, ferns, inCrack, logs, MIST_BANDS, mossMounds, roots, shafts, spores, toLog, trees, type Tree } from "./forestPlan";
import { FOREST } from "./layout";
import { cameraAt, walkXZ } from "./path";
import { span } from "./storyPlan";

const walk = walkXZ();
const toWalk = (x: number, z: number) => Math.min(...walk.map(([a, b]) => Math.hypot(a - x, b - z)));
const forest = trees(220, 7, walk);
const fallen = logs(11, walk, forest, 5);


describe("the forest's depth", () => {
  it("sorts the trunks into near, mid and far layers by their distance from the walk", () => {
    for (const t of forest) {
      const d = toWalk(t.x, t.z);
      expect(t.layer).toBe(d < 9 ? 0 : d < 22 ? 1 : 2);
      expect(t.tint).toBeGreaterThanOrEqual(0);
      expect(t.tint).toBeLessThanOrEqual(1);
    }
    for (const layer of [0, 1, 2]) expect(forest.filter((t) => t.layer === layer).length).toBeGreaterThan(15);
  });

  it("rings the forest with far trunks beyond it, all in the far layer", () => {
    const far = farTrees(120, 3);
    expect(far).toHaveLength(120);
    for (const t of far) {
      const r = Math.hypot(t.x - FOREST.center[0], t.z - FOREST.center[1]);
      expect(r).toBeGreaterThanOrEqual(FOREST.radius);
      expect(r).toBeLessThanOrEqual(FOREST.radius + 30);
      expect(t.layer).toBe(2);
    }
  });
});

describe("the forest floor's detail", () => {
  it("spreads roots from the near and mid trunks, never across the walk or into the crack", () => {
    const r = roots(forest, 5, walk);
    const byTree = new Map<number, number>();
    for (const q of r) {
      const t = forest[q.tree];
      expect(t.layer).toBeLessThan(2);
      byTree.set(q.tree, (byTree.get(q.tree) ?? 0) + 1);
      const tipX = t.x + Math.cos(q.angle) * (t.radius + q.length);
      const tipZ = t.z + Math.sin(q.angle) * (t.radius + q.length);
      expect(toWalk(tipX, tipZ)).toBeGreaterThan(0.9);
      expect(inCrack(tipX, tipZ, -0.5)).toBe(false);
      expect(q.thick).toBeLessThan(t.radius);
    }
    expect(Math.max(...byTree.values())).toBeLessThanOrEqual(6);
    expect(byTree.size).toBeGreaterThan(30);
  });

  it("lays fallen logs beside the walk, clear of it, the crack and the trunks", () => {
    expect(fallen).toHaveLength(5);
    for (const l of fallen) {
      for (let k = 0; k <= 10; k++) {
        const u = k / 10 - 0.5;
        const x = l.x + Math.cos(l.yaw) * l.length * u;
        const z = l.z + Math.sin(l.yaw) * l.length * u;
        expect(toWalk(x, z)).toBeGreaterThan(l.radius + 1.2);
        expect(inCrack(x, z, -1)).toBe(false);
      }
      for (const t of forest) expect(toLog(l, t.x, t.z)).toBeGreaterThan(t.radius + l.radius + 0.2);
      expect(toWalk(l.x, l.z)).toBeLessThan(14);
    }
  });

  it("clusters ferns at the trunks' feet and beside the logs, off the walk", () => {
    const f = ferns(13, walk, forest, fallen, 160);
    expect(f.length).toBe(160);
    for (const q of f) {
      expect(toWalk(q.x, q.z)).toBeGreaterThan(0.9);
      expect(inCrack(q.x, q.z, -0.6)).toBe(false);
      for (const t of forest) expect(Math.hypot(t.x - q.x, t.z - q.z)).toBeGreaterThan(t.radius + 0.1);
      for (const l of fallen) expect(toLog(l, q.x, q.z)).toBeGreaterThan(l.radius * 0.8);
      const nearTrunk = forest.some((t) => Math.hypot(t.x - q.x, t.z - q.z) < t.radius + 3);
      const nearLog = fallen.some((l) => toLog(l, q.x, q.z) < l.radius + 2);
      expect(nearTrunk || nearLog).toBe(true);
    }
  });

  it("piles moss round the trunks' feet", () => {
    const m = mossMounds(17, walk, forest, fallen, 120);
    expect(m.length).toBe(120);
    for (const q of m) {
      expect(inCrack(q.x, q.z, -0.4)).toBe(false);
      expect(toWalk(q.x, q.z)).toBeGreaterThan(q.r * 0.5);
      expect(forest.some((t: Tree) => Math.hypot(t.x - q.x, t.z - q.z) < t.radius + 2.5) || fallen.some((l) => toLog(l, q.x, q.z) < 1.5)).toBe(true);
    }
  });

  it("hangs mist in three bands low over the floor, drifting at their own speeds", () => {
    expect(MIST_BANDS).toHaveLength(3);
    const ys = MIST_BANDS.map((b) => b.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(ys[0]).toBeLessThan(1);
    expect(ys[2]).toBeLessThan(FOREST.canopy / 3);
    expect(new Set(MIST_BANDS.map((b) => b.speed)).size).toBe(3);
  });

  it("keeps the walking eye out of the bands: one below it on the floor, the others hanging above it", () => {
    const [a, b] = span("forest");
    for (let vh = a; vh <= b; vh += 0.05) {
      const eye = cameraAt(vh).position[1] - FOREST.floor;
      if (eye > 6) continue; // still sinking in from above
      for (const m of MIST_BANDS) expect(Math.exp(-(((eye - m.y) / m.thickness) ** 2))).toBeLessThan(0.2);
    }
  });

  it("lets more god-rays through the canopy, and spores drift along the walk", () => {
    expect(shafts(3, walk, forest, 12)).toHaveLength(12);
    const s = spores(19, walk, 500);
    expect(s).toHaveLength(500);
    for (const p of s) {
      expect(toWalk(p[0], p[2])).toBeLessThan(15);
      expect(p[1]).toBeGreaterThanOrEqual(FOREST.floor);
      expect(p[1]).toBeLessThan(FOREST.floor + 12);
    }
  });

  it("is the same every visit", () => {
    expect(trees(220, 7, walk)).toEqual(forest);
    expect(logs(11, walk, forest, 5)).toEqual(fallen);
    expect(ferns(13, walk, forest, fallen, 20)).toEqual(ferns(13, walk, forest, fallen, 20));
  });
});
