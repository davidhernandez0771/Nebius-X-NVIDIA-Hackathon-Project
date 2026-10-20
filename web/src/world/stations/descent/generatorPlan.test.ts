import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { burstAt, convergeAt, POINTS, sampleBox, sampleTriangles, SHARES, splitBudget } from "./generatorPlan";

/** A seeded generator, so the sampling tests are repeatable. */
function seeded(seed = 7) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

describe("the generator's budget", () => {
  it("is 100–150k points on desktop tiers and 20–30k on low", () => {
    expect(POINTS.low).toBeGreaterThanOrEqual(20000);
    expect(POINTS.low).toBeLessThanOrEqual(30000);
    expect(POINTS.high).toBeGreaterThanOrEqual(100000);
    expect(POINTS.ultra).toBeLessThanOrEqual(150000);
  });

  it("splits a count over the pieces by their shares, exactly", () => {
    const total = Object.values(SHARES).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 9);
    for (const n of [7, 1000, POINTS.high]) {
      const parts = splitBudget(n, SHARES);
      expect(Object.values(parts).reduce((s, v) => s + v, 0)).toBe(n);
      for (const k of Object.keys(SHARES) as (keyof typeof SHARES)[]) expect(Math.abs(parts[k] - n * SHARES[k])).toBeLessThanOrEqual(1);
    }
  });
});

describe("sampleTriangles", () => {
  // Two triangles in the z = 0 plane: (0,0)-(1,0)-(0,1) with area 1/2, and (0,0)-(3,0)-(0,-1)... area 3/2.
  const position = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 3, 0, 0, 0, -1, 0]);
  const uv = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);

  it("puts every point on a triangle, with its uv", () => {
    const s = sampleTriangles({ position, index: null, uv }, 2000, seeded());
    for (let i = 0; i < 2000; i++) {
      const [x, y, z] = [s.position[i * 3], s.position[i * 3 + 1], s.position[i * 3 + 2]];
      expect(z).toBe(0);
      const inA = x >= -1e-6 && y >= -1e-6 && x + y <= 1 + 1e-6;
      const inB = x >= -1e-6 && y <= 1e-6 && x / 3 - y <= 1 + 1e-6;
      expect(inA || inB).toBe(true);
      expect(s.uv[i * 2]).toBeGreaterThanOrEqual(-1e-6);
      expect(s.uv[i * 2] + s.uv[i * 2 + 1]).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("weights the triangles by area", () => {
    const s = sampleTriangles({ position, index: null, uv }, 8000, seeded(3));
    let below = 0;
    for (let i = 0; i < 8000; i++) if (s.position[i * 3 + 1] < 0) below++;
    expect(below / 8000).toBeCloseTo(0.75, 1);
  });

  it("reads an index buffer", () => {
    const quad = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const s = sampleTriangles({ position: quad, index: new Uint16Array([0, 1, 2, 0, 2, 3]), uv: null }, 500, seeded());
    for (let i = 0; i < 500; i++) {
      expect(s.position[i * 3]).toBeGreaterThanOrEqual(-1e-6);
      expect(s.position[i * 3]).toBeLessThanOrEqual(1 + 1e-6);
      expect(s.position[i * 3 + 1]).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

describe("sampleBox", () => {
  it("puts every point on the box's surface", () => {
    const half: [number, number, number] = [1, 2, 0.5];
    const pts = sampleBox([10, 0, 0], [0, 0, 0, 1], half, 1000, seeded());
    for (let i = 0; i < 1000; i++) {
      const local = [pts[i * 3] - 10, pts[i * 3 + 1], pts[i * 3 + 2]];
      const onFace = local.some((v, k) => Math.abs(Math.abs(v) - half[k]) < 1e-6);
      expect(onFace).toBe(true);
      local.forEach((v, k) => expect(Math.abs(v)).toBeLessThanOrEqual(half[k] + 1e-6));
    }
  });

  it("turns the box by its quaternion, as three.js does", () => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.1, -0.4));
    const half: [number, number, number] = [1, 2, 0.5];
    const pts = sampleBox([0, 0, 0], [q.x, q.y, q.z, q.w], half, 300, seeded(11));
    const back = q.clone().invert();
    for (let i = 0; i < 300; i++) {
      const v = new THREE.Vector3(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]).applyQuaternion(back);
      const local = [v.x, v.y, v.z];
      expect(local.some((c, k) => Math.abs(Math.abs(c) - half[k]) < 1e-5)).toBe(true);
    }
  });
});

describe("the burst and the convergence (mirrored in the shader)", () => {
  it("starts every point on the ring and ends every point on its target", () => {
    for (let r = 0; r <= 1; r += 0.1) {
      expect(burstAt(0, r)).toBe(0);
      for (let h = 0; h <= 1; h += 0.25) {
        expect(convergeAt(0, r, h)).toBe(0);
        expect(convergeAt(0.97, r, h)).toBe(1);
      }
    }
  });

  it("fills the dark before the room forms: every point has burst before any converges", () => {
    for (let r = 0; r <= 1; r += 0.1) expect(burstAt(0.34, r)).toBe(1);
    for (let r = 0; r <= 1; r += 0.1) for (let h = 0; h <= 1; h += 0.25) expect(convergeAt(0.34, r, h)).toBe(0);
  });

  it("builds from the floor up: low targets land first", () => {
    expect(convergeAt(0.6, 0.5, 0)).toBeGreaterThan(convergeAt(0.6, 0.5, 1));
  });
});
