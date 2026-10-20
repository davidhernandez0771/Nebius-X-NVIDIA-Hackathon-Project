import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CAVERN, CORE } from "./layout";
import { CABLES, CLAMPS_PER_CABLE, CORE_PANELS, JUNCTIONS, RING_BOLTS } from "./reactorPlan";
import { buildReactorDetail, clampGeometry, clampMatrices, junctionGeometry, panelGeometry, REACTOR_TIERS, ringGeometry } from "./reactorGeometry";

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const axisR = (x: number, z: number) => Math.hypot(x - CAVERN.axis[0], z - CAVERN.axis[1]);

describe("the reactor's detail geometry", () => {
  it("bolts every ring: the bolts are part of the ring's mesh, so they spin with it", () => {
    const g = ringGeometry(12, 160);
    const uv = g.attributes.uv;
    let bolts = 0;
    for (let i = 0; i < uv.count; i++) if (uv.getY(i) < -0.5) bolts++;
    expect(bolts).toBeGreaterThan(0);
    // RING_BOLTS bolt heads of the same vertex count each.
    expect(bolts % RING_BOLTS).toBe(0);
  });

  it("clads the core in panels round it, outside the glass and inside the cage, with a window band", () => {
    const g = panelGeometry(16);
    const p = g.attributes.position;
    const ys = new Set<number>();
    for (let i = 0; i < p.count; i++) {
      const r = axisR(p.getX(i), p.getZ(i));
      expect(r).toBeGreaterThan(CORE.radius);
      expect(r).toBeLessThan(CORE.radius + 0.7);
      ys.add(Math.round(p.getY(i) * 10) / 10);
    }
    // Panels per side, top and bottom tiers.
    expect(g.userData.panels).toBe(CORE_PANELS * 2);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(CORE.bottom);
    expect(Math.max(...ys)).toBeLessThanOrEqual(CORE.top);
  });

  it("puts a box at every junction, against the wall", () => {
    const g = junctionGeometry();
    g.computeBoundingBox();
    expect(g.userData.boxes).toBe(JUNCTIONS.length);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) expect(axisR(p.getX(i), p.getZ(i))).toBeGreaterThan(CAVERN.radius - 2.5);
  });

  it("puts a clamp on the cable at each clamp point, its ring round the cable's direction", () => {
    const m = clampMatrices();
    expect(m).toHaveLength(CABLES.length * CLAMPS_PER_CABLE);
    const geo = clampGeometry(8);
    geo.computeBoundingBox();
    // The clamp's axis is its local y; the matrix turns y onto the cable's direction.
    const y = new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(m[0])).normalize();
    expect(Math.abs(y.length() - 1)).toBeLessThan(1e-6);
  });

  for (const tier of ["low", "high", "ultra"] as const) {
    it(`keeps the ${tier} tier's detail inside its budget`, () => {
      const d = buildReactorDetail(tier);
      let drawn = 0;
      for (const p of d) drawn += tris(p.geometry) * (p.instances ?? 1);
      expect(d.length).toBeLessThanOrEqual(5);
      expect(drawn).toBeLessThanOrEqual(REACTOR_TIERS[tier].maxTriangles);
    });
  }
});
