import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BENCH_SCALE, EDIT_VIEW, PAPER, TURNTABLE, TURNTABLE_TOP, benchCartridge, printPose } from "./layout";

const v = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);

describe("the bench's live parts", () => {
  it("stand the cartridge on the turntable the edit camera looks at", () => {
    // Blender aimed "Workbench edit" straight over the turntable.
    expect(EDIT_VIEW.target[0]).toBeCloseTo(TURNTABLE.x, 3);
    expect(EDIT_VIEW.target[2]).toBeCloseTo(TURNTABLE.z, 3);
    const { position, yaw } = benchCartridge();
    expect(position.y - 1.25 * BENCH_SCALE).toBeCloseTo(TURNTABLE_TOP, 6);
    // Its label (+z) faces the camera.
    const face = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const toEye = v(EDIT_VIEW.position).sub(position).setY(0).normalize();
    expect(face.dot(toEye)).toBeGreaterThan(0.999);
  });

  it("frame the whole cartridge in the edit shot", () => {
    const eye = v(EDIT_VIEW.position);
    const ahead = v(EDIT_VIEW.target).sub(eye).normalize();
    const half = (EDIT_VIEW.fov / 2) * (Math.PI / 180);
    const { position } = benchCartridge();
    for (const dy of [-1.25, 1.25]) {
      const p = position.clone().add(new THREE.Vector3(0, dy * BENCH_SCALE, 0));
      expect(ahead.angleTo(p.sub(eye).normalize())).toBeLessThan(half * 0.9);
    }
  });

  it("slide the printed label out of the printer onto its tray", () => {
    const out = new THREE.Vector3(0, 0, 1).applyQuaternion(PAPER.quaternion);
    const start = printPose(0);
    const end = printPose(1);
    // It moves out along the paper's own direction, and rests on the paper.
    expect(end.clone().sub(start).normalize().dot(out)).toBeGreaterThan(0.999);
    expect(end.distanceTo(PAPER.position)).toBeLessThan(0.03);
    expect(printPose(2).equals(end)).toBe(true);
    expect(printPose(0.5).distanceTo(start)).toBeGreaterThan(printPose(0.5).distanceTo(end));
  });
});
