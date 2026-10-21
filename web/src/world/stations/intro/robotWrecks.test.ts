import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildWrecks, modelFromScene } from "./robotWrecks";
import type { RobotSpot, RobotTier } from "./forestRobots";
import type { LodMesh } from "./robotLod";

/** A stand-in model: a 0.2 x 0.6 x 0.2 m column standing on the origin, finely divided so the grid can merge it. */
function column(color: [number, number, number] = [1, 1, 1]): LodMesh {
  const g = new THREE.BoxGeometry(0.2, 0.6, 0.2, 8, 24, 8).translate(0, 0.3, 0);
  const n = g.attributes.position.count;
  return {
    position: Float32Array.from(g.attributes.position.array),
    normal: Float32Array.from(g.attributes.normal.array),
    color: Float32Array.from({ length: n * 3 }, (_, i) => color[i % 3]),
    index: Uint32Array.from(g.index!.array),
  };
}

const spot = (over: Partial<RobotSpot>): RobotSpot => ({ id: "franka", pose: "lying_side", x: 2, z: -3, yaw: 0, scale: 1, sink: 0.3, footprint: 1, ...over });
const TIER: RobotTier = { ids: ["franka", "piper", "ur5e"], coarse: 0.05, detail: 0, near: 5, band: 1.5 };
const FLOOR = 100;

function box(g: THREE.BufferGeometry, from: number, count: number) {
  const b = new THREE.Box3();
  const p = g.attributes.position;
  for (let i = from; i < from + count; i++) b.expandByPoint(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
  return b;
}

describe("the real robots lying in the moss, as geometry", () => {
  it("merges a loaded GLB's parts into one model, each part keeping its colour and its node's transform", () => {
    const scene = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 1, 1) }));
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.25, 0.25, 0.25) }));
    b.position.set(0, 0.5, 0);
    scene.add(a, b);
    const m = modelFromScene(scene);
    expect(m.index.length).toBe(2 * 36);
    let top = -Infinity;
    for (let i = 1; i < m.position.length; i += 3) top = Math.max(top, m.position[i]);
    expect(top).toBeCloseTo(0.55, 5);
    const greys = new Set<number>();
    for (let i = 0; i < m.color.length; i += 3) greys.add(Math.round(m.color[i] * 100) / 100);
    expect(greys).toEqual(new Set([1, 0.25]));
  });

  it("sinks each robot into the moss by its fraction, at its spot", () => {
    const w = buildWrecks({ franka: column() }, [spot({})], TIER, FLOOR);
    w.update(new THREE.Vector3(500, 0, 500));
    const b = box(w.geometry, 0, w.geometry.attributes.position.count);
    const h = b.max.y - b.min.y;
    expect(b.min.y).toBeCloseTo(FLOOR - 0.3 * h, 2);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(2, 2);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(-3, 2);
  });

  it("carries the parts' colours, the model's own height in uv.x (the panel seams) and the level in uv.y", () => {
    const w = buildWrecks({ franka: column([0.25, 0.25, 0.25]) }, [spot({})], { ...TIER, detail: 0.02 }, FLOOR);
    const c = w.geometry.attributes.color;
    const uv = w.geometry.attributes.uv;
    let lo = Infinity, hi = -Infinity;
    const levels = new Set<number>();
    for (let i = 0; i < uv.count; i++) {
      lo = Math.min(lo, uv.getX(i));
      hi = Math.max(hi, uv.getX(i));
      levels.add(uv.getY(i));
      expect(c.getX(i)).toBeCloseTo(0.25, 5);
    }
    expect(lo).toBeCloseTo(0, 2);
    expect(hi).toBeCloseTo(0.6, 2);
    expect(levels).toEqual(new Set([0, 1]));
  });

  it("draws far robots coarse and near ones in detail, dissolving in between, as one index list", () => {
    const spots = [spot({}), spot({ id: "piper", x: 30 })];
    const w = buildWrecks({ franka: column(), piper: column() }, spots, { ...TIER, detail: 0.02 }, FLOOR);
    const far = w.update(new THREE.Vector3(15, FLOOR + 2, 200));
    const atFirst = w.update(new THREE.Vector3(2, FLOOR + 2, -3));
    const band = w.update(new THREE.Vector3(2 + 4.2, FLOOR + 0.4, -3));
    expect(far).toBe(w.ranges.coarse.reduce((s, [a, b]) => s + b - a, 0));
    const [c0, c1] = w.ranges.coarse.map(([a, b]) => b - a);
    const [d0] = w.ranges.detail.map(([a, b]) => b - a);
    expect(d0).toBeGreaterThan(c0);
    expect(atFirst).toBe(d0 + c1);
    expect(band).toBe(c0 + c1 + d0);
    expect(w.geometry.drawRange.count).toBe(band);
    expect(w.geometry.index!.count).toBeGreaterThanOrEqual(band);
  });

  it("leaves out robots the tier doesn't show, and robots whose model didn't load", () => {
    const w = buildWrecks({ franka: column() }, [spot({}), spot({ id: "piper", x: 30 }), spot({ id: "so101", x: 60 })], TIER, FLOOR);
    expect(w.ranges.coarse.length).toBe(1);
  });

  it("slides a leaning robot against its trunk's bark", () => {
    const trunk = { x: 2.6, z: -3, radius: 0.3 };
    const s = spot({ pose: "leaning", yaw: 0, sink: 0.1, lean: trunk });
    const w = buildWrecks({ franka: column() }, [s], TIER, FLOOR);
    const p = w.geometry.attributes.position;
    let gap = Infinity;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > FLOOR + 0.05) gap = Math.min(gap, Math.hypot(p.getX(i) - trunk.x, p.getZ(i) - trunk.z) - trunk.radius);
    expect(Math.abs(gap)).toBeLessThan(0.01);
  });
});
