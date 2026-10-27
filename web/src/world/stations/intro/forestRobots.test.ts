import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { POSES, ROBOT_BOUNDS, ROBOT_IDS, FOREST_SKIP, ROBOT_TIERS, forestRobotUrl, robotSpots, robotUrl, HEROIC } from "./forestRobots";
import { inCrack, logs, trees } from "./forestPlan";
import { cameraAt, walkXZ } from "./path";
import { FOREST } from "./layout";
import { span } from "./storyPlan";
import { readPublic } from "../../../twin/testFiles";

const walk = walkXZ();
const toWalk = (x: number, z: number) => Math.min(...walk.map(([a, b]) => Math.hypot(a - x, b - z)));
const forest = trees(220, 7, walk);
const fallen = logs(11, walk, forest, 5);
const spots = robotSpots(walk, forest, fallen);

/** A GLB's POSITION bounds, from its JSON chunk. */
async function glbBounds(id: (typeof ROBOT_IDS)[number]) {
  const b = await readPublic(forestRobotUrl(id));
  const len = new DataView(b).getUint32(12, true);
  const j = JSON.parse(new TextDecoder().decode(new Uint8Array(b, 20, len)));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of j.meshes)
    for (const p of m.primitives) {
      const a = j.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], a.min[i]);
        max[i] = Math.max(max[i], a.max[i]);
      }
    }
  return { min, max };
}

describe("the real robots lying in the moss", () => {
  it("has a spot for each of the 7 robot models, served from world/models/robots/", () => {
    expect([...ROBOT_IDS]).toEqual(["franka", "fr3", "so101", "piper", "openarm", "ur5e", "xarm6"]);
    expect(spots.map((s) => s.id).sort()).toEqual([...ROBOT_IDS].sort());
    expect(robotUrl("ur5e")).toBe("world/models/robots/ur5e.glb");
  });

  it("knows each model's size, as the GLBs have it (metres, base at the origin, y up)", async () => {
    for (const id of ROBOT_IDS) {
      const b = await glbBounds(id);
      ROBOT_BOUNDS[id].min.forEach((v, i) => expect(v).toBeCloseTo(b.min[i], 2));
      ROBOT_BOUNDS[id].max.forEach((v, i) => expect(v).toBeCloseTo(b.max[i], 2));
      expect(b.min[1]).toBeCloseTo(0, 2);
    }
  });

  it("puts each where the walk passes it, clear of the trunks (but the one it leans on), the logs, the crack and each other", () => {
    for (const s of spots) {
      const d = toWalk(s.x, s.z);
      expect(d).toBeGreaterThan(2.2);
      expect(d).toBeLessThan(8);
      expect(inCrack(s.x, s.z, -1.5)).toBe(false);
      for (const t of forest) {
        if (s.lean && t.x === s.lean.x && t.z === s.lean.z) continue;
        expect(Math.hypot(t.x - s.x, t.z - s.z)).toBeGreaterThan(t.radius + s.footprint);
      }
      for (const l of fallen) expect(Math.hypot(l.x - s.x, l.z - s.z)).toBeGreaterThan(l.length / 2 + s.footprint);
    }
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++)
        expect(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z)).toBeGreaterThan(spots[i].footprint + spots[j].footprint);
  });

  it("leans one against a trunk, right beside it", () => {
    const leaning = spots.filter((s) => s.lean);
    expect(leaning.length).toBeGreaterThanOrEqual(1);
    for (const s of leaning) {
      const t = forest.find((f) => f.x === s.lean!.x && f.z === s.lean!.z)!;
      expect(t).toBeDefined();
      expect(s.lean!.radius).toBe(t.radius);
      expect(Math.hypot(t.x - s.x, t.z - s.z)).toBeLessThan(t.radius + s.footprint + 0.6);
    }
  });

  it("keeps the robots' real proportions (one scale for all, larger than life) and lays them down in different ways", () => {
    for (const s of spots) {
      expect(s.scale).toBe(HEROIC);
      expect(s.sink).toBeGreaterThanOrEqual(0.1);
      expect(s.sink).toBeLessThanOrEqual(0.6);
      expect(POSES[s.pose]).toBeDefined();
    }
    expect(new Set(spots.map((s) => s.pose)).size).toBeGreaterThanOrEqual(4);
  });

  it("lets the camera see each one on its walk: in frame, within 12 m, no trunk in the way, for a while", () => {
    const toSeg = (ax: number, az: number, bx: number, bz: number, px: number, pz: number) => {
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(ax + dx * t - px, az + dz * t - pz);
    };
    const [from] = span("sink");
    const [, to] = span("crack");
    for (const s of spots) {
      let seen = 0;
      for (let vh = from; vh <= to; vh += 0.05) {
        const p = cameraAt(vh);
        const cam = new THREE.PerspectiveCamera(p.fov, 16 / 9, 0.1, 500);
        cam.position.set(...p.position);
        cam.lookAt(new THREE.Vector3(...p.target));
        cam.updateMatrixWorld();
        const v = new THREE.Vector3(s.x, FOREST.floor + 0.5, s.z).project(cam);
        const inFrame = Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9 && v.z < 1;
        const near = Math.hypot(s.x - p.position[0], s.z - p.position[2]) < 12;
        const blocked = forest.some((t) => !(s.lean && t.x === s.lean.x && t.z === s.lean.z) && toSeg(p.position[0], p.position[2], s.x, s.z, t.x, t.z) < t.radius * 1.2);
        if (inFrame && near && !blocked) seen++;
      }
      expect(seen, s.id).toBeGreaterThanOrEqual(4);
    }
  });

  it("is the same every visit", () => {
    expect(robotSpots(walk, forest, fallen)).toEqual(spots);
  });

  it("shows fewer robots, coarser and never in detail on the low tier (phones)", () => {
    expect(ROBOT_TIERS.low.ids.length).toBeLessThan(ROBOT_IDS.length);
    expect(ROBOT_TIERS.low.near).toBe(0);
    // Every robot but those waiting for a clean export.
    const forest = ROBOT_IDS.filter((id) => !FOREST_SKIP.includes(id));
    expect(ROBOT_TIERS.high.ids).toEqual(forest);
    expect(ROBOT_TIERS.ultra.ids).toEqual(forest);
    expect(FOREST_SKIP).toEqual([]);
    // fr3 and the OpenArm from the forest's own clean exports; the wall keeps the originals.
    expect(forestRobotUrl("fr3")).toBe("world/models/forest/robots/fr3.glb");
    expect(forestRobotUrl("ur5e")).toBe(robotUrl("ur5e"));
    for (const t of Object.values(ROBOT_TIERS)) for (const id of t.ids) expect(ROBOT_IDS).toContain(id);
  });
});
