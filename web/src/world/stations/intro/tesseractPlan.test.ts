import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  EDGES, ISO, OPEN, OPEN_REACH, STILL, VERTICES, W_DIST, edgeKind, hyperFrame, hyperPose, place4, project, rotate4, type Angles4,
} from "./tesseractPlan";
import { INTRO_VH, span } from "./storyPlan";

const len4 = (v: readonly number[]) => Math.hypot(...v);
const ZERO: Angles4 = { xw: 0, zw: 0 };

describe("the tesseract: 16 vertices and 32 edges in 4D", () => {
  it("has every corner of the 4D cube (±1 on x, y, z and w) once, and an edge wherever two differ on one axis", () => {
    expect(VERTICES).toHaveLength(16);
    expect(new Set(VERTICES.map((v) => v.join())).size).toBe(16);
    for (const v of VERTICES) for (const c of v) expect(Math.abs(c)).toBe(1);
    expect(EDGES).toHaveLength(32);
    for (const [a, b] of EDGES) expect(VERTICES[a].filter((c, i) => c !== VERTICES[b][i]).length).toBe(1);
    const degree = VERTICES.map((_, i) => EDGES.filter(([a, b]) => a === i || b === i).length);
    expect(degree.every((d) => d === 4)).toBe(true);
  });

  it("sorts the edges into the inner cube (w = -1, teal), the outer cube (w = +1) and the 8 links between them", () => {
    const kinds = EDGES.map(edgeKind);
    expect(kinds.filter((k) => k === "inner")).toHaveLength(12);
    expect(kinds.filter((k) => k === "outer")).toHaveLength(12);
    expect(kinds.filter((k) => k === "link")).toHaveLength(8);
  });
});

describe("4D rotation and the projection to 3D", () => {
  it("rotates without stretching, and a full turn comes back", () => {
    for (const v of VERTICES) {
      const r = rotate4(v, { xw: 0.7, zw: -1.3 });
      expect(len4(r)).toBeCloseTo(2, 9);
      const back = rotate4(v, { xw: Math.PI * 2, zw: Math.PI * 2 });
      back.forEach((c, i) => expect(c).toBeCloseTo(v[i], 9));
    }
  });

  it("turns in the XW plane: y stays, and at a half turn an outer corner has crossed to the inner cube (w = -1)", () => {
    const outer = VERTICES.find((v) => v[3] === 1)!;
    const r = rotate4(outer, { xw: Math.PI, zw: 0 });
    expect(r[1]).toBeCloseTo(outer[1], 9);
    expect(r[3]).toBeCloseTo(-1, 9);
  });

  it("projects with perspective in w: the outer cube larger than the inner, by the flat mark's ratio (about 0.43)", () => {
    const big = project([1, 1, 1, 1]);
    const small = project([1, 1, 1, -1]);
    expect(small[0] / big[0]).toBeCloseTo((W_DIST - 1) / (W_DIST + 1), 9);
    expect(small[0] / big[0]).toBeGreaterThan(0.38);
    expect(small[0] / big[0]).toBeLessThan(0.48);
  });
});

describe("a frame of the tesseract", () => {
  it("draws all 32 edges and a joint at every vertex but the open one", () => {
    const f = hyperFrame(ZERO);
    expect(f.tubes).toHaveLength(32);
    expect(f.joints).toHaveLength(15);
    expect(f.joints.some((j) => j.vertex === OPEN)).toBe(false);
  });

  it("leaves the open corner open at every angle: its 4 edges stop short of it, the others reach both ends", () => {
    for (const a of [ZERO, { xw: 1.1, zw: 2.3 }, { xw: 4, zw: -2 }]) {
      const f = hyperFrame(a);
      const corner = project(place4(VERTICES[OPEN], a));
      for (const t of f.tubes) {
        const [i, j] = EDGES[t.edge];
        const touches = i === OPEN || j === OPEN;
        const far = Math.min(t.from.distanceTo(new THREE.Vector3(...corner)), t.to.distanceTo(new THREE.Vector3(...corner)));
        if (touches) expect(far).toBeGreaterThan(0.05);
        else expect(t.length).toBeGreaterThan(0);
      }
      expect(f.tubes.filter((t) => EDGES[t.edge].includes(OPEN))).toHaveLength(4);
      expect(OPEN_REACH).toBeGreaterThan(0.4);
      expect(OPEN_REACH).toBeLessThan(0.8);
    }
  });

  it("is the outer corner the flat mark leaves open: up and to the right in the still, isometric pose, with the teal cube pushed toward it", () => {
    const iso = new THREE.Matrix4().makeRotationFromEuler(ISO);
    const at = (v: readonly number[]) => new THREE.Vector3(...project(place4(v, STILL))).applyMatrix4(iso);
    const corner = at(VERTICES[OPEN]);
    expect(VERTICES[OPEN][3]).toBe(1);
    // On the outer hexagon at 30° (upper right), not one of the two corners in its middle.
    const angle = (Math.atan2(corner.y, corner.x) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(20);
    expect(angle).toBeLessThan(40);
    // The outer cube stays a true cube (a regular hexagon in this view); only the inner one moves.
    const outer = VERTICES.filter((v) => v[3] === 1).map(at);
    const radii = outer.map((p) => Math.hypot(p.x, p.y)).filter((r) => r > 0.05);
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-6);
    const inner = at([0, 0, 0, -1]);
    const dir = new THREE.Vector2(inner.x, inner.y);
    expect(dir.length()).toBeGreaterThan(0.08);
    expect(dir.normalize().dot(new THREE.Vector2(corner.x, corner.y).normalize())).toBeGreaterThan(0.85);
  });
});

describe("the tesseract's pose along the story", () => {
  it("is the still logo pose under reduced motion, whatever the scroll or the time", () => {
    expect(hyperPose(3, 50, true)).toEqual({ ...STILL });
  });

  it("follows the scroll through the hero (scrubbable: the same scroll, the same pose) and turns on its own when idle", () => {
    const [, end] = span("sink");
    expect(hyperPose(0.3, 0, false)).toEqual(hyperPose(0.3, 0, false));
    expect(hyperPose(end * 0.8, 0, false).xw).toBeGreaterThan(hyperPose(0.1, 0, false).xw);
    expect(hyperPose(0.2, 4, false).xw).toBeGreaterThan(hyperPose(0.2, 0, false).xw);
    // Past the sink it holds where the scroll left it.
    expect(hyperPose(INTRO_VH, 0, false)).toEqual(hyperPose(end, 0, false));
  });
});
