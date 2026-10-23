import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { armPoints, solveArm } from "./armIk";
import { crossing, faceYaw, handRoll, idlePose, idleWrist } from "./Arm";
import { HELIX } from "./layout";

describe("the arm in the middle", () => {
  it("waits inside the spiral behind the cartridge it looks at, crossing none of them", () => {
    const inner = Math.min(...HELIX.map((s) => Math.hypot(s.position[0], s.position[2])));
    for (const s of HELIX) {
      const p = idlePose(idleWrist(new THREE.Vector3(...s.position)));
      for (const pt of armPoints(p)) expect(Math.hypot(pt.x, pt.z)).toBeLessThan(inner - 0.17 - 0.3);
      expect(crossing(p, false, new THREE.Vector3())).toBeNull();
    }
  });

  it("opens the spiral where it reaches out through it", () => {
    const p = solveArm(new THREE.Vector3(5, 6, 0));
    const band = crossing(p, false, new THREE.Vector3());
    expect(band).not.toBeNull();
    expect(band![0]).toBeLessThanOrEqual(band![1]);
  });

  it("turns the hand so its fingers close across a cartridge's thickness", () => {
    // The fingers part along the hand's x; with the hand hanging down, that is world yaw armYaw - roll + π/2.
    for (const [armYaw, face] of [[0, 0], [1, -0.5], [-2, 2.5]]) {
      const roll = handRoll(armYaw, face);
      const across = armYaw - roll + Math.PI / 2;
      const d = Math.atan2(Math.sin(across - face), Math.cos(across - face));
      expect(Math.abs(d)).toBeLessThan(1e-9);
    }
    expect(faceYaw(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7))).toBeCloseTo(0.7, 9);
  });
});
