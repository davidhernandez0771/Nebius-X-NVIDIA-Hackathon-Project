import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BACKDROP_R, FOREST_TIERS, buildForest, fernGeometry, trunkBend, trunkGeometry, tube } from "./forestGeometry";
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

  it("puts branches on the near and mid trunks, high up and on the trunk (where its shader has bent it)", () => {
    const f = buildForest("high");
    const canopy = f.pieces.find((p) => p.name === "canopy")!;
    const near = f.layout.trees.filter((t) => t.layer === 0).length;
    const mid = f.layout.trees.filter((t) => t.layer === 1).length;
    expect(canopy.instances).toBe((near * 4 + mid * 2) * 2);
    for (const m of canopy.matrices!) {
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      expect(p.y).toBeGreaterThan(FOREST.floor + FOREST.canopy * 0.25);
      // On a trunk: off some near or mid trunk's straight axis by no more than its bend there (turned with the
      // trunk) and its lean, plus a little.
      const ok = f.layout.trees.filter((t) => t.layer < 2).some((t) => {
        const y = (p.y - FOREST.floor) / t.height;
        const bend = Math.hypot(...trunkBend(t.tint, y)) * t.radius;
        const lean = Math.hypot(t.lean[0], t.lean[1]) * t.height * y;
        return Math.hypot(p.x - t.x, p.z - t.z) <= bend + lean + 0.3;
      });
      expect(ok).toBe(true);
    }
  });

  it("rings the forest with a backdrop beyond its last trunks, the forest going on in the fog", () => {
    const f = buildForest("high");
    const back = f.pieces.find((p) => p.name === "backdrop")!;
    back.geometry.computeBoundingBox();
    const b = back.geometry.boundingBox!;
    expect((b.max.x - b.min.x) / 2).toBeCloseTo(BACKDROP_R, 0);
    const far = Math.max(...f.layout.far.map((t) => Math.hypot(t.x - FOREST.center[0], t.z - FOREST.center[1]) + t.radius));
    expect(BACKDROP_R).toBeGreaterThan(far);
  });

  it("gives the low tier (and phones) less of everything than high, the same places", () => {
    const low = buildForest("low");
    const high = buildForest("high");
    const count = (f: ReturnType<typeof buildForest>, name: string) => f.pieces.find((p) => p.name === name)?.instances ?? 0;
    for (const name of ["trunks:near", "ferns", "moss"]) expect(count(low, name)).toBeLessThan(count(high, name));
    expect(low.layout.trees.every((t, i) => t.x === high.layout.trees[i].x)).toBe(true);
  });
});
