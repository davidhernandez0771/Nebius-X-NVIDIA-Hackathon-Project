import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readPublic } from "../../../twin/testFiles";
import { buildForest } from "./forestGeometry";
import { CHEST_R, HERO_TREES, TREES_URL, TREE_VARIANTS, barkName, leavesName, mergeTrees, treeMeshes, treePlan } from "./forestTrees";

async function meshes() {
  const b = await readPublic(TREES_URL);
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(new Uint8Array(b));
  const gltf = await new Promise<{ scene: THREE.Object3D }>((ok, no) => new GLTFLoader().parse(buf, "", ok, no));
  return treeMeshes(gltf.scene);
}

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe("the forest's modelled trees (trees.glb)", () => {
  it("has the three variants at four levels of bark and three of leaves, the levels getting lighter", async () => {
    const m = await meshes();
    for (let v = 0; v < TREE_VARIANTS.length; v++) {
      const t = [0, 1, 2, 3].map((l) => tris(m[barkName(v, l as 0 | 1 | 2 | 3)]!));
      for (let l = 1; l < 4; l++) expect(t[l]).toBeLessThan(t[l - 1]);
      for (const l of [0, 1, 2] as const) expect(m[leavesName(v, l)]).toBeDefined();
      // Standing on the ground at the origin, tall like the procedural trunks.
      m[barkName(v, 0)]!.computeBoundingBox();
      const b = m[barkName(v, 0)]!.boundingBox!;
      expect(b.min.y).toBeLessThan(0);
      expect(b.max.y).toBeGreaterThan(25);
    }
  }, 30_000);

  it("draws every tree of the layout: each in its place, scaled evenly from its chest radius, the variants mixed", () => {
    for (const tier of ["low", "high", "ultra"] as const) {
      const { layout } = buildForest(tier);
      const plan = treePlan(layout, tier);
      expect(plan.length).toBe(layout.trees.length + layout.far.length);
      expect(new Set(plan.map((t) => t.variant))).toEqual(new Set([0, 1, 2]));
      expect(plan.filter((t) => t.lod === 0).length).toBe(Math.min(HERO_TREES[tier], layout.trees.filter((t) => t.layer === 0).length));
      plan.forEach((p) => {
        const t = p.index < 1000 ? layout.trees[p.index] : layout.far[p.index - 1000];
        const pos = new THREE.Vector3(), scale = new THREE.Vector3();
        p.matrix.decompose(pos, new THREE.Quaternion(), scale);
        expect(pos.x).toBeCloseTo(t.x, 5);
        expect(pos.z).toBeCloseTo(t.z, 5);
        expect(scale.x).toBeCloseTo(t.radius / CHEST_R, 5);
        expect(scale.y / scale.x).toBeGreaterThan(0.9);
        expect(scale.y / scale.x).toBeLessThan(1.1);
        // Near trees at near levels, the mist's silhouettes at the lightest.
        expect(p.lod).toBe(p.index >= 1000 || t.layer === 2 ? 3 : t.layer === 1 ? 2 : p.lod);
      });
    }
  });

  it("merges each level into one draw (four of bark, one of leaves), lighter than the procedural trunks, roots and branches it replaces", async () => {
    const m = await meshes();
    for (const tier of ["low", "high", "ultra"] as const) {
      const f = buildForest(tier);
      const merged = mergeTrees(treePlan(f.layout, tier), m);
      expect(merged.bark.length).toBeLessThanOrEqual(4);
      expect(merged.leaves).not.toBeNull();
      const replaced = f.pieces
        .filter((p) => p.name.startsWith("trunks:") || p.name === "roots" || p.name === "canopy")
        .reduce((s, p) => s + tris(p.geometry) * (p.instances ?? 1), 0);
      expect(merged.triangles).toBeLessThanOrEqual(replaced);
      for (const { geometry } of merged.bark) for (const a of ["position", "normal", "uv", "color", "aTint"]) expect(geometry.attributes[a]).toBeDefined();
    }
  }, 60_000);
});
