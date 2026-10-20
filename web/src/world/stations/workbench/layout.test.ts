import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BENCH_SCALE, EDIT_VIEW, PRINT_H, PRINT_QUATERNION, SLOT, TURNTABLE, TURNTABLE_TOP, benchCartridge, printPose } from "./layout";

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

  it("feed the printed label out of the printer's slot, turned toward the edit camera", () => {
    const along = new THREE.Vector3(0, 0, 1).applyQuaternion(PRINT_QUATERNION);
    const start = printPose(0);
    const end = printPose(1);
    expect(end.clone().sub(start).normalize().dot(along)).toBeGreaterThan(0.999);
    // All inside the printer at the start, all out at the end (its near edge past the slot).
    expect(start.clone().sub(SLOT).dot(along)).toBeLessThan(-PRINT_H / 2);
    expect(end.clone().sub(SLOT).dot(along)).toBeGreaterThan(PRINT_H / 2);
    expect(printPose(2).equals(end)).toBe(true);
    // Its face sees the camera better than lying flat would, and its far edge stays over the bench top.
    const face = new THREE.Vector3(0, 1, 0).applyQuaternion(PRINT_QUATERNION);
    const toEye = v(EDIT_VIEW.position).sub(end).normalize();
    expect(face.dot(toEye)).toBeGreaterThan(new THREE.Vector3(0, 1, 0).dot(toEye) + 0.15);
    // bx_B_Mat, the bench's cutting mat, is the top: 3.335.
    expect(end.clone().addScaledVector(along, PRINT_H / 2).y).toBeGreaterThan(3.335);
  });
});

describe("the bench in the room view, and a save's flight", () => {
  it("stands the draft on the turntable in the room, where the bench opens it", async () => {
    const { benchMatrix } = await import("./layout");
    const { BENCH_PIVOT } = await import("../../scene/layout");
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    benchMatrix().decompose(p, q, s);
    const home = benchCartridge();
    expect(p.distanceTo(home.position.clone().add(v(BENCH_PIVOT.position)))).toBeLessThan(1e-9);
    expect(q.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw))).toBeLessThan(1e-6);
    expect(s.x).toBeCloseTo(BENCH_SCALE, 9);
  });

  it("flies a saved cartridge from the turntable to its empty place on the spiral, up and clear first", async () => {
    const { flightPose, benchMatrix } = await import("./layout");
    const { SPARE } = await import("../../scene/layout");
    const start = new THREE.Vector3().setFromMatrixPosition(benchMatrix());
    const out = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 0 };
    SPARE.forEach((slot, place) => {
      flightPose(place, 0, out);
      expect(out.position.distanceTo(start)).toBeLessThan(1e-9);
      expect(out.scale).toBeCloseTo(BENCH_SCALE, 9);
      flightPose(place, 1, out);
      expect(out.position.distanceTo(v(slot.position))).toBeLessThan(1e-9);
      expect(out.quaternion.angleTo(new THREE.Quaternion(...slot.quaternion))).toBeLessThan(1e-6);
      expect(out.scale).toBeCloseTo(slot.scale, 9);
      let prev = start.clone();
      for (let u = 0.01; u <= 1.0001; u += 0.01) {
        flightPose(place, u, out);
        expect(out.position.distanceTo(prev)).toBeLessThan(0.6);
        // Off the turntable upward first: it never dips into the bench.
        if (u < 0.25) expect(out.position.y).toBeGreaterThanOrEqual(prev.y - 1e-9);
        prev = out.position.clone();
      }
    });
  });
});
