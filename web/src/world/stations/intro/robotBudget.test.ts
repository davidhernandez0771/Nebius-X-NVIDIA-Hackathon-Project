import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildForest, FOREST_TIERS } from "./forestGeometry";
import { ROBOT_TIERS, robotUrl, type RobotId } from "./forestRobots";
import { FOREST } from "./layout";
import { cameraAt } from "./path";
import { INTRO_VH } from "./storyPlan";
import { buildWrecks, modelFromScene } from "./robotWrecks";
import type { LodMesh } from "./robotLod";
import { readPublic } from "../../../twin/testFiles";

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

async function model(id: RobotId): Promise<LodMesh> {
  const b = await readPublic(robotUrl(id));
  // Copied into this realm's ArrayBuffer: GLTFLoader tells binary from JSON with instanceof.
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(new Uint8Array(b));
  const gltf = await new Promise<{ scene: THREE.Object3D }>((ok, no) => new GLTFLoader().parse(buf, "", ok, no));
  return modelFromScene(gltf.scene);
}

describe("the forest with its real robots, per tier", () => {
  for (const tier of ["low", "high", "ultra"] as const) {
    it(`keeps the ${tier} tier inside the forest's budget all the way along the camera's path (triangles drawn, draw calls)`, async () => {
      const f = buildForest(tier);
      let pieces = 0;
      for (const p of f.pieces) pieces += tris(p.geometry) * (p.instances ?? 1);
      const T = ROBOT_TIERS[tier];
      const models = Object.fromEntries(await Promise.all(T.ids.map(async (id) => [id, await model(id)] as const)));
      const w = buildWrecks(models, f.layout.robots, T, FOREST.floor);
      expect(w.centers.length).toBe(T.ids.length);
      let most = 0;
      for (let vh = 0; vh <= INTRO_VH; vh += 0.005) most = Math.max(most, w.update(new THREE.Vector3(...cameraAt(vh).position)) / 3);
      console.info(`forest ${tier}: pieces ${pieces} + robots at most ${most} = ${pieces + most} of ${FOREST_TIERS[tier].maxTriangles}; draws ${f.pieces.length} + 1`);
      expect(pieces + most).toBeLessThanOrEqual(FOREST_TIERS[tier].maxTriangles);
      expect(f.pieces.length + 1).toBeLessThanOrEqual(FOREST_TIERS[tier].maxDraws);
    }, 60_000);
  }
});
