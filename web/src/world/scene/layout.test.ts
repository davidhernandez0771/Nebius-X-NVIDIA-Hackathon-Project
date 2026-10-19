import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { BENCH_PIVOT, HELIX, LIBRARY, MACHINE_PIVOT, stop, stopFrom, zupQuat, type StopName } from "./layout";

describe("the Blender layout", () => {
  it("has the 29 spiral slots and 442 library slots", () => {
    expect(HELIX).toHaveLength(29);
    expect(LIBRARY).toHaveLength(442);
    expect(new Set(HELIX.map((s) => s.code))).toEqual(new Set(["S101", "FR3", "PPR", "RZ4", "OPN"]));
  });

  it("turns Blender's Z-up quaternions so each spiral cartridge faces out from the axis", () => {
    for (const s of HELIX) {
      const face = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...s.quaternion));
      const out = new Vector3(s.position[0], 0, s.position[2]).normalize();
      expect(face.dot(out)).toBeGreaterThan(0.85);
    }
  });

  it("keeps the rotation a unit quaternion and maps the axes the glTF way", () => {
    const q = new Quaternion(...zupQuat([Math.SQRT1_2, 0, 0, Math.SQRT1_2]));
    // 90° about Blender +Z is 90° about +Y once Y is up: +x goes to -z.
    const v = new Vector3(1, 0, 0).applyQuaternion(q);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(-1, 6);
    for (const s of [...HELIX, ...LIBRARY]) expect(Math.hypot(...s.quaternion)).toBeCloseTo(1, 3);
  });

  it("puts the machine and the bench either side of the spiral, turned 28° toward it", () => {
    expect(MACHINE_PIVOT.position[0]).toBeGreaterThan(5);
    expect(BENCH_PIVOT.position[0]).toBeLessThan(-5);
    expect(MACHINE_PIVOT.yaw).toBeCloseTo((28 * Math.PI) / 180, 6);
    expect(BENCH_PIVOT.yaw).toBeCloseTo((-28 * Math.PI) / 180, 6);
  });

  it("has every camera stop the journey uses", () => {
    const names: StopName[] = ["Title", "One demo → 100", "Proof", "Descent", "Workshop intro", "Tutorial 1 · shelf", "Tutorial 2 · machine", "Tutorial 3 · bench", "Plug in", "Projection", "Zoom to UI", "Workbench edit"];
    for (const n of names) {
      const p = stop(n);
      expect([...p.position, ...p.target, p.fov].every(Number.isFinite)).toBe(true);
    }
    expect(() => stop("Nowhere" as StopName)).toThrow(/no camera stop/);
    const local = stopFrom([1, 2, 3], "Title");
    expect(local.position).toEqual([-1, 35, 21]);
  });
});
