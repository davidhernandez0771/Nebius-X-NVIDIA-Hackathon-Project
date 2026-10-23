import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildForest, FOREST_TIERS } from "./forestGeometry";
import { ROBOT_TIERS, forestRobotUrl, type RobotId } from "./forestRobots";
import { FOREST } from "./layout";
import { cameraAt } from "./path";
import { dropLight, INTRO_VH, placeLights } from "./storyPlan";
import { WALK_DEPTH, fissureGeometry } from "./Crack";
import { CRACK_SLOT, depthOrder } from "./crackSlot";
import { buildWrecks, modelFromScene } from "./robotWrecks";
import { riftTriangles } from "./riftDetail";
import type { LodMesh } from "./robotLod";
import { readPublic } from "../../../twin/testFiles";

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

async function scene(path: string): Promise<THREE.Object3D> {
  const b = await readPublic(path);
  // Copied into this realm's ArrayBuffer: GLTFLoader tells binary from JSON with instanceof.
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(new Uint8Array(b));
  const gltf = await new Promise<{ scene: THREE.Object3D }>((ok, no) => new GLTFLoader().parse(buf, "", ok, no));
  return gltf.scene;
}

const model = async (id: RobotId): Promise<LodMesh> => modelFromScene(await scene(forestRobotUrl(id)));

/** The crack model's triangles: all of them, and those the walk draws (Crack.tsx). */
async function crackTris(): Promise<{ all: number; walk: number }> {
  let all = 0, walk = 0;
  (await scene(CRACK_SLOT.url)).traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!(o as THREE.Mesh).isMesh || !g?.index) return;
    const d = depthOrder(g.index.array, g.attributes.position.array, WALK_DEPTH);
    all += d.index.length / 3;
    walk += d.above / 3;
  });
  return { all, walk };
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
      // Each frame along the camera's path: the forest (pieces and robots) while it is lit, and the crack while the
      // forest or the fall is lit: its top from the forest, all of it in the fall (the low tier: the procedural one).
      const fissure = tris(fissureGeometry());
      const crack = tier === "low" ? { all: 0, walk: 0 } : await crackTris();
      let most = 0, robotsMost = 0, fall = 0;
      // The robots drawn are those in the camera's view: a 16:9 desktop, and on the low tier a portrait phone too.
      const aspects = tier === "low" ? [16 / 9, 390 / 844] : [16 / 9];
      const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 220);
      const view = new THREE.Frustum();
      const inView = (vh: number, aspect: number) => {
        const p = cameraAt(vh);
        cam.fov = p.fov;
        cam.aspect = aspect;
        cam.updateProjectionMatrix();
        cam.position.set(...p.position);
        cam.lookAt(...p.target);
        cam.updateMatrixWorld();
        return view.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      };
      for (let vh = 0; vh <= INTRO_VH; vh += 0.005) {
        const robots = Math.max(...aspects.map((a) => w.update(new THREE.Vector3(...cameraAt(vh).position), inView(vh, a)))) / 3;
        const forest = placeLights(vh).forest > 0, drop = dropLight(vh) > 0;
        const frame = (forest ? pieces + robots + riftTriangles(tier) : 0) + (forest || drop ? fissure + (drop ? crack.all : crack.walk) : 0);
        if (forest) robotsMost = Math.max(robotsMost, robots);
        if (drop && !forest) fall = Math.max(fall, frame);
        most = Math.max(most, frame);
      }
      console.info(`forest ${tier}: pieces ${pieces} + robots at most ${robotsMost} + crack ${fissure} + ${crack.walk} (walk) / ${crack.all} (fall); worst frame ${most} of ${FOREST_TIERS[tier].maxTriangles}, the fall alone ${fall}; draws ${f.pieces.length} + 1 robots + ${tier === "low" ? 1 : 2} crack`);
      expect(most).toBeLessThanOrEqual(FOREST_TIERS[tier].maxTriangles);
      // The pieces' draws are budgeted; the robots are one more, the crack one (low) or two (its fissure and model).
      expect(f.pieces.length).toBeLessThanOrEqual(FOREST_TIERS[tier].maxDraws);
    }, 60_000);
  }
});
