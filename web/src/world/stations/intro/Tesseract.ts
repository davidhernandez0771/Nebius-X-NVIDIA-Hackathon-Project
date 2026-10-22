// The hero's tesseract (tesseractPlan.ts does the 4D maths): steel tubes with ball joints for the outer cube and
// the links, glowing teal tubes for the inner cube, after the mark's 3D look (docs/design/logo/tesseract-3d-A.png).
// Three instanced draws, their matrices laid along the projected edges every update. In the logo's units (the old
// ring's radius is 1); Scene.tsx scales and turns the group. Low tier and phones: thinner tubes, fewer sides.
//
// Unlit, on purpose: matcaps made here (polished steel, and a bright one the teal tints into a glow). A lit
// material (MeshPhysical) recompiled its shaders when the workshop's lamps joined the scene a second after the
// hero appeared, about 180 ms of stalls on ultra; a matcap ignores the scene's lights, and is cheap to compile and
// to draw.
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
/** The inner cube's colour: brighter than white (linear), with a pale, hot core. The bloom clamps each pixel to 1
 *  before its 0.8 threshold; a pure teal (no red) clamps to about 0.78 and never blooms, so the core carries some
 *  red and blue, and the hero's one glow comes back. */
const TEAL_GLOW = new THREE.Color(0.62, 1.35, 1.12);

const toSrgb = (c: number) => {
  const v = Math.min(1, Math.max(0, c));
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
};

/** A matcap (the shade of a sphere seen from the front, by its normal), `size` square, made here: polished steel,
 *  or a bright `glow` one that a colour tints. Rows run bottom up, as three's matcap lookup expects. */
function matcap(size: number, kind: "steel" | "glow"): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const key = new THREE.Vector3(-0.5, 0.6, 0.62).normalize();
  const fill = new THREE.Vector3(0.6, -0.3, 0.5).normalize();
  const n = new THREE.Vector3();
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let u = ((x + 0.5) / size) * 2 - 1, v = ((y + 0.5) / size) * 2 - 1;
      const r = Math.hypot(u, v);
      if (r > 1) [u, v] = [u / r, v / r];
      n.set(u, v, Math.sqrt(Math.max(0, 1 - u * u - v * v)));
      const k = Math.max(0, n.dot(key));
      const spec = k ** 24 * 0.8 + k ** 160 * 2;
      const rim = (1 - n.z) ** 3;
      let c: [number, number, number];
      if (kind === "steel") {
        // Polished #8a9197 steel: a dark body, the long softbox it reflects up top (bright, soft-edged), a hot key
        // highlight, a faint floor bounce below and a cold rim. Contrast is what reads as polish.
        const band = Math.exp(-(((n.y - 0.5) / 0.16) ** 2)) * (0.35 + 0.65 * n.z);
        const floor = Math.exp(-(((n.y + 0.55) / 0.2) ** 2)) * 0.08;
        const a = [0.25, 0.28, 0.31];
        c = [0, 1, 2].map((i) => a[i] * (0.14 + 0.1 * Math.max(0, n.dot(fill))) + band * 0.55 + floor + spec + rim * 0.2 * (i ? 1.06 : 0.94)) as [number, number, number];
      } else {
        // Bright across the whole tube, not just its middle, so all of it clears the bloom's threshold.
        const l = 0.75 + 0.3 * n.z + 0.2 * spec;
        c = [l, l, l];
      }
      data.set([toSrgb(c[0]), toSrgb(c[1]), toSrgb(c[2]), 255], (y * size + x) * 4);
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** The steel matcap (exported for the tests). */
export const steelMatcap = (size: number) => matcap(size, "steel");

export interface TesseractHandle {
  group: THREE.Group;
  update(a: Angles4): void;
  /** The hero's light, 0–1: the steel and the glow fade with it. */
  setLight(light: number): void;
  dispose(): void;
}

export function makeTesseract(q: QualityTier): TesseractHandle {
  const look = TESSERACT_LOOK[q.name];
  const steel = steelMatcap(q.name === "low" ? 64 : 128);
  const glow = matcap(64, "glow");
  const chrome = new THREE.MeshMatcapMaterial({ matcap: steel });
  // Not tone-mapped, as the site's other glows (PostFX.tsx): tone mapping would squeeze it under the bloom's threshold.
  const teal = new THREE.MeshMatcapMaterial({ matcap: glow, color: TEAL_GLOW, toneMapped: false });
  const joints = new THREE.MeshMatcapMaterial({ matcap: steel });

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
    update,
    setLight(light) {
      chrome.color.setScalar(light);
      joints.color.setScalar(light);
      teal.color.copy(TEAL_GLOW).multiplyScalar(light);
    },
    dispose() {
      tubeGeo.dispose();
      ballGeo.dispose();
      chrome.dispose();
      teal.dispose();
      steel.dispose();
      glow.dispose();
      joints.dispose();
      for (const m of [chromeTubes, tealTubes, balls]) m.dispose();
    },
  };
}
