import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FOREST_TIERS, buildForest, fernGeometry, trunkGeometry, tube } from "./forestGeometry";
import { FOREST } from "./layout";

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe("the forest's geometry", () => {
  it("draws near trunks in more detail than far ones (levels of detail)", () => {
    const [near, mid, far] = [0, 1, 2].map((l) => tris(trunkGeometry(l as 0 | 1 | 2)));
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it("builds tapered tubes with normals and an along/around uv", () => {
    const g = tube([[0, 0, 0], [0, 1, 0], [0, 2, 0.2]], [0.3, 0.2, 0.05], 6);
    expect(g.attributes.normal).toBeDefined();
    expect(g.attributes.uv.count).toBe(g.attributes.position.count);
    expect(tris(g)).toBe(2 * 6 * 2);
  });

  it("builds a fern as fronds round its centre, about a metre across", () => {
    const g = fernGeometry(8);
    g.computeBoundingBox();
    const size = g.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(0.8);
    expect(size.x).toBeLessThan(1.6);
    expect(size.y).toBeGreaterThan(0.3);
  });

  for (const tier of ["low", "high", "ultra"] as const) {
    it(`keeps the ${tier} tier's forest inside its budget (triangles drawn, draw calls)`, () => {
      const f = buildForest(tier);
      let drawn = 0;
      for (const p of f.pieces) drawn += tris(p.geometry) * (p.instances ?? 1);
      expect(f.pieces.length).toBeLessThanOrEqual(FOREST_TIERS[tier].maxDraws);
      expect(drawn).toBeLessThanOrEqual(FOREST_TIERS[tier].maxTriangles);
      // Every piece sits in the forest's volume.
      for (const p of f.pieces) {
        if (p.instances) continue;
        p.geometry.computeBoundingBox();
        expect(p.geometry.boundingBox!.min.y).toBeGreaterThan(FOREST.floor - 40);
      }
    });
  }

  it("gives the low tier (and phones) less of everything than high, the same places", () => {
    const low = buildForest("low");
    const high = buildForest("high");
    const count = (f: ReturnType<typeof buildForest>, name: string) => f.pieces.find((p) => p.name === name)?.instances ?? 0;
    for (const name of ["trunks:near", "ferns", "moss"]) expect(count(low, name)).toBeLessThan(count(high, name));
    expect(low.layout.trees.every((t, i) => t.x === high.layout.trees[i].x)).toBe(true);
  });
});
