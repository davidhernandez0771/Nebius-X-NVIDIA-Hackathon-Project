import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BLOCKS, PEDESTAL, ROOM, SPIRAL_R, cartridgeBody, clear, resolve, sweep } from "./collide";
import { HELIX, MACHINE_PIVOT } from "./layout";
import { ABOVE_PORT } from "./plugSequence";

const body = cartridgeBody(1);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe("what a carried cartridge can't pass through", () => {
  it("measures the desk under the machine where the machine stands", () => {
    const desk = BLOCKS.find((b) => b.name === "desk")!;
    expect(desk.center[0]).toBeCloseTo(MACHINE_PIVOT.position[0], 6);
    expect(desk.yaw).toBeCloseTo(MACHINE_PIVOT.yaw, 9);
  });

  it("lifts a cartridge pushed into a table onto its top", () => {
    const p = v(-9, 1, -0.5);
    const hits = resolve(p, body);
    expect(hits).toContain("bench");
    expect(p.y).toBeGreaterThan(2.75 + body.half);
    expect(clear(p, body)).toBe(true);
  });

  it("slides it along a wall instead of into it", () => {
    const p = v(30, 6, 0);
    resolve(p, body);
    expect(p.x).toBeCloseTo(ROOM.x[1] - body.radius, 6);
    expect(p.y).toBe(6);
  });

  it("keeps it out of the spiral, round the side it came from", () => {
    const p = v(1, 6, 1);
    resolve(p, body);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(SPIRAL_R, 6);
    expect(Math.atan2(p.x, p.z)).toBeCloseTo(Math.PI / 4, 6);
  });

  it("stands it on the floor, and on the pedestal near the spiral", () => {
    const far = v(12, -3, 8);
    resolve(far, body);
    expect(far.y).toBeCloseTo(ROOM.floor + body.half + 0.06, 6);
    const near = v(0, -3, -4.3);
    resolve(near, body);
    expect(near.y).toBeCloseTo(PEDESTAL.top + body.half + 0.06, 6);
  });

  it("goes over a table on the way across it, never through, and back down beyond", () => {
    // Low on the bench's near side to low on its far side.
    const from = v(-4, 0.8, 4.5);
    const to = v(-14, 0.8, -5);
    resolve(from, body);
    const out = new THREE.Vector3();
    const path: THREE.Vector3[] = [];
    let at = from.clone();
    for (let i = 0; i < 40; i++) {
      // A frame's worth of the way at a time (the carry's speed limit), as Dragged moves it.
      const next = at.clone().add(to.clone().sub(at).clampLength(0, 0.5));
      sweep(at, next, body, out, 0.25);
      path.push(out.clone());
      at = out.clone();
    }
    for (const p of path) expect(clear(p, body)).toBe(true);
    expect(Math.max(...path.map((p) => p.y))).toBeGreaterThan(2.75 + body.half);
  });

  it("leaves the machine's port clear for the drop, and every slot's way out", () => {
    expect(clear(ABOVE_PORT.clone(), body)).toBe(true);
    for (const s of HELIX) {
      const out = v(s.position[0], s.position[1] + 0.3, s.position[2]);
      const r = Math.hypot(out.x, out.z);
      out.multiplyScalar((SPIRAL_R + 0.01) / r).setY(s.position[1] + 0.3);
      expect(Math.hypot(out.x, out.z)).toBeGreaterThanOrEqual(SPIRAL_R);
    }
  });
});
