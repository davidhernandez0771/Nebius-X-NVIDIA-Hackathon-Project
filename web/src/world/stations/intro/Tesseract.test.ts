import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TIERS } from "../../core/quality";
import { makeTesseract, TESSERACT_LOOK } from "./Tesseract";
import { EDGES, OPEN, STILL, hyperFrame } from "./tesseractPlan";

const env = new THREE.Texture();
const meshes = (g: THREE.Object3D) => {
  const out: THREE.InstancedMesh[] = [];
  g.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && out.push(o as THREE.InstancedMesh));
  return out;
};

describe("the tesseract, drawn", () => {
  it("is three draws: chrome tubes (outer cube and links), teal tubes (the inner cube), joints", () => {
    const t = makeTesseract(TIERS.high, env);
    const m = meshes(t.group);
    expect(m).toHaveLength(3);
    const byName = Object.fromEntries(m.map((x) => [x.name, x]));
    expect(byName["tesseract:chrome"].count).toBe(20);
    expect(byName["tesseract:teal"].count).toBe(12);
    // A joint at 15 corners (not the open one), and a round cap where each of its 4 edges stops.
    expect(byName["tesseract:joints"].count).toBe(19);
    t.dispose();
  });

  it("lays each tube along its edge every update: centred between its ends, its length along y", () => {
    const t = makeTesseract(TIERS.high, env);
    t.update(STILL);
    const f = hyperFrame(STILL);
    const chrome = meshes(t.group).find((x) => x.name === "tesseract:chrome")!;
    const tubes = f.tubes.filter((x) => x.kind !== "inner");
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    tubes.forEach((tube, i) => {
      chrome.getMatrixAt(i, m);
      m.decompose(p, q, s);
      expect(p.distanceTo(tube.from.clone().add(tube.to).multiplyScalar(0.5))).toBeLessThan(1e-6);
      expect(s.y).toBeCloseTo(tube.length, 6);
      const along = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      expect(Math.abs(along.dot(tube.to.clone().sub(tube.from).normalize()))).toBeCloseTo(1, 6);
    });
    expect(tubes.some((x) => EDGES[x.edge].includes(OPEN))).toBe(true);
    t.dispose();
  });

  it("is thinner, with fewer sides, on the low tier (and phones)", () => {
    const hi = makeTesseract(TIERS.high, env);
    const lo = makeTesseract(TIERS.low, env);
    const tube = (t: ReturnType<typeof makeTesseract>) => meshes(t.group).find((x) => x.name === "tesseract:chrome")!.geometry as THREE.CylinderGeometry;
    expect(tube(lo).parameters.radiusTop).toBeLessThan(tube(hi).parameters.radiusTop);
    expect(tube(lo).parameters.radialSegments).toBeLessThan(tube(hi).parameters.radialSegments);
    expect(TESSERACT_LOOK.low.tube).toBeLessThan(TESSERACT_LOOK.high.tube);
    hi.dispose();
    lo.dispose();
  });
});
