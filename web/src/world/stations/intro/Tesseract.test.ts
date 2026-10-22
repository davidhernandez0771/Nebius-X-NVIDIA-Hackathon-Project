import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TIERS } from "../../core/quality";
import { makeTesseract, steelMatcap, TESSERACT_LOOK } from "./Tesseract";
import { EDGES, OPEN, STILL, hyperFrame } from "./tesseractPlan";

const meshes = (g: THREE.Object3D) => {
  const out: THREE.InstancedMesh[] = [];
  g.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && out.push(o as THREE.InstancedMesh));
  return out;
};

describe("the tesseract, drawn", () => {
  it("is three draws: chrome tubes (outer cube and links), teal tubes (the inner cube), joints", () => {
    const t = makeTesseract(TIERS.high);
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
    const t = makeTesseract(TIERS.high);
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

  it("is unlit (a steel matcap and a teal glow): no lights in the scene change its shaders, so nothing recompiles when the workshop's lamps arrive", () => {
    const t = makeTesseract(TIERS.ultra);
    for (const m of meshes(t.group)) {
      const mat = m.material as THREE.Material;
      expect(mat.type).toBe("MeshMatcapMaterial");
      expect((mat as THREE.MeshMatcapMaterial).matcap).toBeInstanceOf(THREE.DataTexture);
    }
    t.dispose();
  });

  it("makes its steel matcap in code: dark steel with a bright highlight, never white all over", () => {
    const size = 64;
    const m = steelMatcap(size);
    const px = m.image.data as Uint8Array;
    // Over the sphere's disk (what a normal can look up), not the corners.
    let lum = 0, peak = 0, n = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (Math.hypot(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1) > 0.98) continue;
        const i = (y * size + x) * 4;
        const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
        lum += l;
        peak = Math.max(peak, l);
        n++;
      }
    lum /= n;
    expect(lum).toBeLessThan(110);
    expect(peak).toBeGreaterThan(200);
  });

  it("fades with the hero's light: the steel and the teal glow go to black at 0", () => {
    const t = makeTesseract(TIERS.high);
    t.setLight(0);
    for (const m of meshes(t.group)) expect((m.material as THREE.MeshMatcapMaterial).color.getHex()).toBe(0);
    t.setLight(1);
    const teal = meshes(t.group).find((x) => x.name === "tesseract:teal")!.material as THREE.MeshMatcapMaterial;
    expect(teal.color.g).toBeGreaterThan(1); // brighter than white: the bloom's glow
    t.dispose();
  });

  it("glows: the teal's core, clamped to 1 as the bloom's high pass does, is brighter than the bloom's 0.8 threshold", () => {
    const t = makeTesseract(TIERS.ultra);
    t.setLight(1);
    const teal = meshes(t.group).find((x) => x.name === "tesseract:teal")!.material as THREE.MeshMatcapMaterial;
    const px = teal.matcap!.image.data as Uint8Array;
    const size = teal.matcap!.image.width;
    const i = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4; // the centre: a face toward the camera
    const lin = (v: number) => new THREE.Color().setRGB(v / 255, 0, 0, THREE.SRGBColorSpace).r;
    const c = [teal.color.r, teal.color.g, teal.color.b].map((k, j) => Math.min(1, k * lin(px[i + j])));
    expect(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]).toBeGreaterThan(0.85);
    // And it reaches the bloom as it is: not tone-mapped down first.
    expect(teal.toneMapped).toBe(false);
    t.dispose();
  });

  it("is thinner, with fewer sides, on the low tier (and phones)", () => {
    const hi = makeTesseract(TIERS.high);
    const lo = makeTesseract(TIERS.low);
    const tube = (t: ReturnType<typeof makeTesseract>) => meshes(t.group).find((x) => x.name === "tesseract:chrome")!.geometry as THREE.CylinderGeometry;
    expect(tube(lo).parameters.radiusTop).toBeLessThan(tube(hi).parameters.radiusTop);
    expect(tube(lo).parameters.radialSegments).toBeLessThan(tube(hi).parameters.radialSegments);
    expect(TESSERACT_LOOK.low.tube).toBeLessThan(TESSERACT_LOOK.high.tube);
    hi.dispose();
    lo.dispose();
  });
});
