import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { bayGeometry } from "./bay";
import { MACHINE_PIVOT } from "./layout";
import { BAY, DOCK_TOP, PLUGGED, PLUGGED_Q, PORT_TOP, cartridgePose, PHASE } from "./plugSequence";

/** A world point in the bay's own frame (x across the slot, z along it, y up from the dock's top). */
const toBay = (p: THREE.Vector3) => p.clone().sub(DOCK_TOP).applyAxisAngle(new THREE.Vector3(0, 1, 0), -MACHINE_PIVOT.yaw);

/** The seated cartridge's corners (cartridge.glb: 2.3 wide, 2.5 tall, 0.34 thick), world. */
function corners(pos: THREE.Vector3, q: THREE.Quaternion): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [-1.15, 1.15]) for (const y of [-1.25, 1.25]) for (const z of [-0.17, 0.17]) out.push(new THREE.Vector3(x, y, z).applyQuaternion(q).add(pos));
  return out;
}

describe("the cartridge bay on the dock", () => {
  it("takes a seated cartridge's whole footprint inside its opening, with clearance, never touching a wall", () => {
    for (const c of corners(PLUGGED, PLUGGED_Q).map(toBay)) {
      expect(Math.abs(c.x)).toBeLessThan(BAY.halfShort - 0.02);
      expect(Math.abs(c.z)).toBeLessThan(BAY.halfLong - 0.02);
      // It rests on the dock's top, not under it.
      expect(c.y).toBeGreaterThan(-1e-6);
    }
  });

  it("sinks 40–60% of the cartridge into it, so its edge connector and sides are out of sight", () => {
    const bottom = PLUGGED.y - 1.25;
    const sunk = PORT_TOP.y - bottom;
    expect(sunk / 2.5).toBeGreaterThan(0.4);
    expect(sunk / 2.5).toBeLessThan(0.6);
    expect(bottom).toBeCloseTo(DOCK_TOP.y, 6);
  });

  it("comes down into it straight, inside the opening from the mouth to the seat", () => {
    for (let u = PHASE.insert[0]; u <= PHASE.insert[1]; u += 0.01) {
      const c = cartridgePose(0, u);
      for (const k of corners(c.position, c.quaternion).map(toBay)) {
        if (k.y > BAY.height) continue; // still above the mouth
        expect(Math.abs(k.x)).toBeLessThan(BAY.halfShort);
        expect(Math.abs(k.z)).toBeLessThan(BAY.halfLong);
      }
    }
  });

  it("is built to those sizes: the opening inside the walls, the lip round the mouth", () => {
    const { shell, lip } = bayGeometry();
    shell.computeBoundingBox();
    lip.computeBoundingBox();
    expect(shell.boundingBox!.max.y).toBeCloseTo(BAY.height, 6);
    expect(shell.boundingBox!.max.z).toBeGreaterThan(BAY.halfLong + BAY.wall - 1e-6);
    expect(lip.boundingBox!.max.y).toBeCloseTo(BAY.height + 0.035, 6);
    expect(shell.getAttribute("color")).toBeTruthy();
    expect(shell.getAttribute("aMR").itemSize).toBe(2);
    // No shell vertex stands inside the opening above the floor (the cartridge's way down is clear).
    const pos = shell.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = Math.abs(pos.getX(i));
      const z = Math.abs(pos.getZ(i));
      const y = pos.getY(i);
      if (y > 0.095) expect(x >= BAY.halfShort - 0.007 - 1e-6 || z >= BAY.halfLong - 0.007 - 1e-6).toBe(true);
    }
  });
});
