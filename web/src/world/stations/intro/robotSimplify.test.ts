import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { openEdgeShare, simplifyLod } from "./robotSimplify";
import type { LodMesh } from "./robotLod";

/** A three.js geometry as a robot model: one colour, its own normals (split at hard edges, as GLBs are). */
function asModel(g: THREE.BufferGeometry, color: [number, number, number] = [0.8, 0.8, 0.8]): LodMesh {
  const ng = g.index ? g : g;
  const n = ng.attributes.position.count;
  const index = ng.index ? Uint32Array.from(ng.index.array) : Uint32Array.from({ length: n }, (_, i) => i);
  return {
    position: Float32Array.from(ng.attributes.position.array),
    normal: Float32Array.from(ng.attributes.normal.array),
    color: Float32Array.from({ length: n * 3 }, (_, i) => color[i % 3]),
    index,
  };
}

const tris = (m: LodMesh) => m.index.length / 3;

function faceNormal(m: LodMesh, t: number): THREE.Vector3 {
  const v = (k: number) => new THREE.Vector3().fromArray(m.position, m.index[t + k] * 3);
  const a = v(0), b = v(1), c = v(2);
  return b.sub(a).cross(c.sub(a));
}

/** The largest distance from any of `pts`' vertices to the surface of a sphere of radius r at the origin. */
const sphereError = (m: LodMesh, r: number) => {
  let e = 0;
  for (let i = 0; i < m.position.length; i += 3) e = Math.max(e, Math.abs(Math.hypot(m.position[i], m.position[i + 1], m.position[i + 2]) - r));
  return e;
};

describe("a robot's lower detail, simplified by edge collapse (quadric error)", () => {
  it("reaches the triangle target (or close under it) and leaves no collapsed triangles", () => {
    const m = asModel(new THREE.SphereGeometry(0.5, 64, 48)); // ~6k triangles
    const l = simplifyLod(m, 800);
    expect(tris(l)).toBeLessThanOrEqual(800);
    expect(tris(l)).toBeGreaterThan(600);
    for (let t = 0; t < l.index.length; t += 3) {
      const [a, b, c] = [l.index[t], l.index[t + 1], l.index[t + 2]];
      expect(a !== b && b !== c && a !== c).toBe(true);
      expect(faceNormal(l, t).length()).toBeGreaterThan(0);
    }
  });

  it("keeps the shape: a sphere stays a sphere, with its faces still facing out", () => {
    const m = asModel(new THREE.SphereGeometry(0.5, 64, 48));
    const l = simplifyLod(m, 500);
    expect(sphereError(l, 0.5)).toBeLessThan(0.02);
    let outward = 0;
    for (let t = 0; t < l.index.length; t += 3) {
      const c = new THREE.Vector3();
      for (let k = 0; k < 3; k++) c.add(new THREE.Vector3().fromArray(l.position, l.index[t + k] * 3));
      if (faceNormal(l, t).dot(c) > 0) outward++;
    }
    expect(outward).toBe(tris(l));
  });

  it("keeps hard edges hard: a box's corners stay put and its faces keep flat normals", () => {
    const box = new THREE.BoxGeometry(0.4, 0.2, 0.3, 12, 12, 12);
    const l = simplifyLod(asModel(box), 60);
    const b = new THREE.Box3();
    for (let i = 0; i < l.position.length; i += 3) b.expandByPoint(new THREE.Vector3().fromArray(l.position, i));
    expect(b.min.toArray().map((v) => +v.toFixed(3))).toEqual([-0.2, -0.1, -0.15]);
    expect(b.max.toArray().map((v) => +v.toFixed(3))).toEqual([0.2, 0.1, 0.15]);
    // Every vertex normal is one of the six face directions (no smoothing round the 90° edges).
    for (let i = 0; i < l.normal.length; i += 3) {
      const n = [l.normal[i], l.normal[i + 1], l.normal[i + 2]];
      expect(Math.max(...n.map(Math.abs))).toBeCloseTo(1, 3);
    }
  });

  it("smooths curved surfaces: a cylinder's side normals point out from its axis", () => {
    const l = simplifyLod(asModel(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 48, 8)), 200);
    for (let i = 0; i < l.position.length; i += 3) {
      const [x, y, z] = [l.position[i], l.position[i + 1], l.position[i + 2]];
      const [nx, ny, nz] = [l.normal[i], l.normal[i + 1], l.normal[i + 2]];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 4);
      if (Math.abs(ny) < 0.5 && Math.abs(y) < 0.29) expect((x * nx + z * nz) / Math.hypot(x, z)).toBeGreaterThan(0.97);
    }
  });

  it("keeps each part's colour and keeps parts apart (a white shell and a dark joint never blend)", () => {
    const a = asModel(new THREE.BoxGeometry(0.2, 0.2, 0.2, 6, 6, 6), [1, 1, 1]);
    const b = asModel(new THREE.BoxGeometry(0.2, 0.2, 0.2, 6, 6, 6).translate(0.2, 0, 0), [0.1, 0.1, 0.1]);
    const off = a.position.length / 3;
    const both: LodMesh = {
      position: Float32Array.from([...a.position, ...b.position]),
      normal: Float32Array.from([...a.normal, ...b.normal]),
      color: Float32Array.from([...a.color, ...b.color]),
      index: Uint32Array.from([...a.index, ...[...b.index].map((i) => i + off)]),
    };
    const l = simplifyLod(both, 40);
    const colours = new Set<string>();
    for (let i = 0; i < l.color.length; i += 3) colours.add(`${l.color[i].toFixed(2)},${l.color[i + 1].toFixed(2)},${l.color[i + 2].toFixed(2)}`);
    expect([...colours].sort()).toEqual(["0.10,0.10,0.10", "1.00,1.00,1.00"]);
  });

  it("returns the model itself when it is already under the target", () => {
    const m = asModel(new THREE.BoxGeometry(1, 1, 1));
    const l = simplifyLod(m, 1000);
    expect(tris(l)).toBe(12);
  });

  it("tells a clean model from a triangle soup (the export with cracks everywhere that no collapse can simplify)", () => {
    expect(openEdgeShare(asModel(new THREE.SphereGeometry(0.5, 32, 24)))).toBeLessThan(0.01);
    // Every triangle on its own, a hair apart from its neighbours: nothing welds.
    const soup = asModel(new THREE.SphereGeometry(0.5, 32, 24).toNonIndexed());
    for (let i = 0; i < soup.position.length; i++) soup.position[i] += ((i * 7919) % 13) * 1e-4;
    expect(openEdgeShare(soup)).toBeGreaterThan(0.9);
  });

  it("stays manifold-safe unless asked: a pinched mesh may stall above the target, the relaxed pass reaches it", () => {
    // Two spheres touching at one vertex share it after welding: the collapses round the pinch are refused.
    const a = new THREE.SphereGeometry(0.2, 24, 16);
    const b = new THREE.SphereGeometry(0.2, 24, 16).translate(0, 0.4, 0);
    const m = asModel(mergeGeometries([a, b])!);
    expect(tris(simplifyLod(m, 40, { relaxed: true }))).toBeLessThanOrEqual(40);
    expect(tris(simplifyLod(m, 40))).toBeGreaterThanOrEqual(tris(simplifyLod(m, 40, { relaxed: true })));
  });

  it("is deterministic", () => {
    const m = asModel(new THREE.TorusKnotGeometry(0.3, 0.08, 120, 12));
    expect(simplifyLod(m, 700)).toEqual(simplifyLod(m, 700));
  });
});
