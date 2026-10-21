// The hero's tesseract (tesseractPlan.ts does the 4D maths): chrome tubes with ball joints for the outer cube and
// the links, glowing teal tubes for the inner cube, after the mark's 3D look (docs/design/logo/tesseract-3d-A.png).
// Three instanced draws, their matrices laid along the projected edges every update. In the logo's units (the old
// ring's radius is 1); Scene.tsx scales and turns the group. Low tier and phones: thinner tubes, fewer sides.
import * as THREE from "three";
import type { QualityTier, TierName } from "../../core/quality";
import { EDGES, OPEN, hyperFrame, type Angles4 } from "./tesseractPlan";

export const TESSERACT_LOOK: Record<TierName, { tube: number; sides: number; ball: [number, number] }> = {
  low: { tube: 0.024, sides: 8, ball: [10, 8] },
  high: { tube: 0.034, sides: 16, ball: [20, 14] },
  ultra: { tube: 0.034, sides: 20, ball: [24, 16] },
};

/** A joint's radius, to the tube's (the outer cube's chrome balls); the inner cube's joints just round its corners. */
const BALL = 1.7;
const TEAL = new THREE.Color("#19f5c2");

export interface TesseractHandle {
  group: THREE.Group;
  /** The materials, whose light the hero fades. */
  materials: { chrome: THREE.MeshPhysicalMaterial; teal: THREE.MeshPhysicalMaterial; joints: THREE.MeshPhysicalMaterial };
  update(a: Angles4): void;
  dispose(): void;
}

export function makeTesseract(q: QualityTier, env: THREE.Texture): TesseractHandle {
  const look = TESSERACT_LOOK[q.name];
  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0xe6eaed,
    metalness: 1,
    roughness: 0.12,
    clearcoat: q.name === "low" ? 0 : 0.6,
    clearcoatRoughness: 0.08,
    envMap: env,
    envMapIntensity: 1.4,
  });
  const teal = new THREE.MeshPhysicalMaterial({
    color: 0xa2f4e0,
    emissive: TEAL,
    emissiveIntensity: 0.85,
    roughness: 0.3,
    metalness: 0,
    envMap: env,
    envMapIntensity: 0.6,
  });
  const joints = chrome.clone();

  const tubeGeo = new THREE.CylinderGeometry(look.tube, look.tube, 1, look.sides, 1, true);
  const ballGeo = new THREE.SphereGeometry(1, ...look.ball);
  const first = hyperFrame({ xw: 0, zw: 0 });
  const nChrome = first.tubes.filter((t) => t.kind !== "inner").length;
  const nTeal = first.tubes.length - nChrome;
  // A round cap where each of the open corner's 4 edges stops short.
  const nCaps = 4;
  const chromeTubes = new THREE.InstancedMesh(tubeGeo, chrome, nChrome);
  const tealTubes = new THREE.InstancedMesh(tubeGeo, teal, nTeal);
  const balls = new THREE.InstancedMesh(ballGeo, joints, first.joints.length + nCaps);
  chromeTubes.name = "tesseract:chrome";
  tealTubes.name = "tesseract:teal";
  balls.name = "tesseract:joints";
  const group = new THREE.Group();
  group.name = "intro:tesseract";
  for (const m of [chromeTubes, tealTubes, balls]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.raycast = () => {};
    group.add(m);
  }

  const Y = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const mid = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const chromeColor = new THREE.Color(1, 1, 1);
  const tealColor = new THREE.Color("#7ff0d4");

  function update(a: Angles4) {
    const f = hyperFrame(a);
    let c = 0, t = 0, b = 0;
    const ball = (at: THREE.Vector3, r: number, color: THREE.Color) => {
      balls.setMatrixAt(b, m4.compose(at, q4.identity(), scale.setScalar(r)));
      balls.setColorAt(b++, color);
    };
    for (const tube of f.tubes) {
      mid.copy(tube.from).add(tube.to).multiplyScalar(0.5);
      dir.copy(tube.to).sub(tube.from);
      q4.setFromUnitVectors(Y, tube.length > 1e-9 ? dir.normalize() : Y);
      m4.compose(mid, q4, scale.set(1, Math.max(tube.length, 1e-6), 1));
      if (tube.kind === "inner") tealTubes.setMatrixAt(t++, m4);
      else chromeTubes.setMatrixAt(c++, m4);
    }
    for (const j of f.joints) ball(j.at, j.kind === "inner" ? look.tube : look.tube * BALL, j.kind === "inner" ? tealColor : chromeColor);
    // Round caps where the open corner's edges stop short.
    for (const tube of f.tubes) if (EDGES[tube.edge].includes(OPEN)) ball(tube.to, look.tube, chromeColor);
    for (const m of [chromeTubes, tealTubes, balls]) m.instanceMatrix.needsUpdate = true;
    if (balls.instanceColor) balls.instanceColor.needsUpdate = true;
  }
  update({ xw: 0, zw: 0 });

  return {
    group,
    materials: { chrome, teal, joints },
    update,
    dispose() {
      tubeGeo.dispose();
      ballGeo.dispose();
      chrome.dispose();
      teal.dispose();
      joints.dispose();
      for (const m of [chromeTubes, tealTubes, balls]) m.dispose();
    },
  };
}
