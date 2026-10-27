import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ARM, SHOULDER_MAX, SHOULDER_MIN, armPoints, clampReach, solveArm, wristAbove } from "./armIk";
import { HELIX } from "./layout";
import { ABOVE_PORT } from "./plugSequence";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe("the arm's IK", () => {
  it("puts the wrist on the point, with the hand hanging straight down", () => {
    for (const w of [v(1.5, 4, 0.5), v(-2.8, 9, 1.1), v(0.3, 2.2, -3.6), v(4.2, 6, -2.5), v(-5.1, 7, 1.5)]) {
      const p = solveArm(w);
      expect(p.reachable).toBe(true);
      const [, , wrist, tip] = armPoints(p);
      expect(wrist.distanceTo(w)).toBeLessThan(1e-6);
      expect(p.shoulder + p.elbow + p.wrist).toBeCloseTo(Math.PI, 9);
      expect(tip.x).toBeCloseTo(wrist.x, 9);
      expect(tip.y).toBeCloseTo(wrist.y - ARM.hand, 9);
    }
  });

  it("keeps the elbow bent upward and the shoulder within the mast's travel", () => {
    for (const w of [v(1, 1, 1), v(0.2, 12, 0), v(5.5, 7, 0), v(-3, 0.5, -3)]) {
      const p = solveArm(w);
      const [s, e, wr] = armPoints(p);
      expect(p.shoulderY).toBeGreaterThanOrEqual(SHOULDER_MIN - 1e-9);
      expect(p.shoulderY).toBeLessThanOrEqual(SHOULDER_MAX + 1e-9);
      expect(p.elbow).toBeGreaterThan(0);
      // Elbow up: above the straight line from the shoulder to the wrist.
      const t = (Math.hypot(e.x, e.z) - 0) / Math.max(1e-6, Math.hypot(wr.x, wr.z));
      expect(e.y).toBeGreaterThanOrEqual(s.y + (wr.y - s.y) * t - 1e-6);
    }
  });

  it("slides the sleeve out only when the arm alone is too short", () => {
    expect(solveArm(v(1.5, 5, 0)).ext).toBe(0);
    expect(solveArm(v(5.6, 6, 0)).ext).toBeGreaterThan(0);
  });

  it("reaches over the machine's port to load it", () => {
    // The fingertips hold the cartridge's top edge (half its 2.5 m height above its centre).
    const grip = ABOVE_PORT.clone().setY(ABOVE_PORT.y + 1.25);
    expect(clampReach(grip).distanceTo(grip)).toBe(0);
    const p = solveArm(wristAbove(grip));
    expect(p.reachable).toBe(true);
    expect(armPoints(p)[3].distanceTo(grip)).toBeLessThan(1e-6);
  });

  it("takes every spiral cartridge by its top edge", () => {
    for (const s of HELIX) {
      const grip = v(s.position[0], s.position[1] + 1.25, s.position[2]);
      const p = solveArm(wristAbove(grip));
      expect(p.reachable).toBe(true);
    }
  });

  it("pulls an out-of-reach point in toward the axis, keeping its height and bearing", () => {
    const far = v(12, 5, 5);
    const c = clampReach(far);
    expect(c.y).toBe(5);
    expect(Math.atan2(c.x, c.z)).toBeCloseTo(Math.atan2(far.x, far.z), 9);
    expect(Math.hypot(c.x, c.z)).toBeLessThan(Math.hypot(far.x, far.z));
    expect(solveArm(wristAbove(c)).reachable).toBe(true);
  });
});
