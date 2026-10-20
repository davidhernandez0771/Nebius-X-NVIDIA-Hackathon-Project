import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { HELIX, MACHINE_PIVOT } from "./layout";
import { ABOVE_PORT, PHASE, PLUGGED, PLUGGED_Q, PLUG_S, cartridgePose, projection, scrollU, slotGlow, timeU } from "./plugSequence";

describe("the plug-in", () => {
  it("starts in the slot and ends seated in the port, edge-on along the slot", () => {
    for (const slot of [0, 11, 28]) {
      const s = HELIX[slot];
      const start = cartridgePose(slot, 0);
      expect(start.position.toArray()).toEqual([...s.position]);
      const end = cartridgePose(slot, 1);
      expect(end.position.distanceTo(PLUGGED)).toBeLessThan(1e-6);
      expect(end.quaternion.angleTo(PLUGGED_Q)).toBeLessThan(1e-6);
    }
    // Width (local x) along the machine's local z; upright.
    const width = new THREE.Vector3(1, 0, 0).applyQuaternion(PLUGGED_Q);
    expect(width.x).toBeCloseTo(Math.sin(MACHINE_PIVOT.yaw), 6);
    expect(width.z).toBeCloseTo(Math.cos(MACHINE_PIVOT.yaw), 6);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(PLUGGED_Q).y).toBeCloseTo(1, 6);
  });

  it("moves without a jump at every phase boundary", () => {
    let prev = cartridgePose(0, 0).position.clone();
    for (let u = 0.002; u <= 1; u += 0.002) {
      const p = cartridgePose(0, u).position;
      expect(p.distanceTo(prev)).toBeLessThan(0.12);
      prev = p.clone();
    }
  });

  it("clears the desk, the machine, the port and every other cartridge from any slot", () => {
    const half = new THREE.Vector3(1.15, 1.25, 0.17);
    const box = (p: THREE.Vector3, q: THREE.Quaternion, h = half) => new OBB(p.clone(), h.clone(), new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)));
    // The machine's furniture in its own unturned frame (x along its length), from machine.glb's
    // nodes and the baked bounds: the desk, the body under the shroud, the port at its left end.
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), MACHINE_PIVOT.yaw);
    const pivot = new THREE.Vector3(...MACHINE_PIVOT.position);
    const local = (x: number, z: number, y0: number, y1: number, hx: number, hz: number) =>
      box(pivot.clone().add(new THREE.Vector3(x, 0, z).applyQuaternion(yaw)).setY((y0 + y1) / 2), yaw, new THREE.Vector3(hx, (y1 - y0) / 2, hz));
    const furniture = { desk: local(0, 0, -0.6, 2.69, 4, 2.1), body: local(0, 0, 2.69, 4.45, 3.1, 1.25), port: local(-3.7, 0, 2.69, 4.29, 0.6, 1.08) };
    const others = HELIX.map((s) => box(new THREE.Vector3(...s.position), new THREE.Quaternion(...s.quaternion)));
    for (const s of HELIX) {
      for (let u = PHASE.pull[1] * 0.5; u <= PHASE.fly[1]; u += 0.004) {
        const c = cartridgePose(s.index, u);
        const me = box(c.position, c.quaternion);
        for (const [name, f] of Object.entries(furniture)) expect(me.intersectsOBB(f), `slot ${s.index} u=${u.toFixed(3)} hits the ${name}`).toBe(false);
        others.forEach((o, i) => i !== s.index && expect(me.intersectsOBB(o), `slot ${s.index} u=${u.toFixed(3)} hits slot ${i}`).toBe(false));
      }
    }
  });

  it("lights the slot only once seated, and the projector last", () => {
    expect(slotGlow(PHASE.insert[0])).toBe(0);
    expect(slotGlow(PHASE.click[0] + 0.001)).toBeGreaterThan(1);
    expect(slotGlow(1)).toBe(1);
    expect(projection(PHASE.click[1])).toBe(0);
    expect(projection(1)).toBe(1);
  });

  it("follows the scroll: in by the Plug in stop, projecting before the Projection stop", () => {
    expect(scrollU(0)).toBe(0);
    expect(scrollU(0.5)).toBeCloseTo(PHASE.click[1], 6);
    expect(scrollU(0.85)).toBe(1);
    for (let t = 0.01; t <= 1; t += 0.01) expect(scrollU(t)).toBeGreaterThanOrEqual(scrollU(t - 0.01));
  });

  it("runs in PLUG_S after a click, or lands at once with reduced motion", () => {
    expect(timeU(10, 10, false)).toBe(0);
    expect(timeU(10, 10 + PLUG_S / 2, false)).toBeCloseTo(0.5, 6);
    expect(timeU(10, 10 + PLUG_S * 2, false)).toBe(1);
    expect(timeU(10, 10, true)).toBe(1);
  });

  it("held (a drag dropped it over the port): waits above the port, then drops in on the click's beat", () => {
    for (const slot of [0, 11, 30]) {
      for (const u of [0, 0.2, PHASE.fly[1]]) {
        const held = cartridgePose(slot, u, undefined, true);
        expect(held.position.distanceTo(ABOVE_PORT)).toBeLessThan(1e-9);
        expect(held.quaternion.angleTo(PLUGGED_Q)).toBeLessThan(1e-6);
      }
      // From the insert on it is a click's, so the camera, the slot and the projector keep their timing.
      for (const u of [PHASE.insert[0] + 0.01, PHASE.click[0], 1]) {
        expect(cartridgePose(slot, u, undefined, true).position.distanceTo(cartridgePose(slot, u).position)).toBeLessThan(1e-9);
      }
      expect(cartridgePose(slot, 1, undefined, true).position.distanceTo(PLUGGED)).toBeLessThan(1e-6);
    }
  });
});
