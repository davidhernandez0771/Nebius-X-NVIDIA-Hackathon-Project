import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MAT_TOP, TURNTABLE_LOCAL, TURNTABLE_TOP, benchFrame, benchPoint } from "./layout";
import { MAT_D, MAT_W, makeMat, setMatHover } from "./mat";

describe("the bench's live mat", () => {
  it("lies over the baked mat, turned with the bench, its grid in the bench's own metres", () => {
    const { mesh, release } = makeMat();
    const pos = mesh.geometry.getAttribute("position");
    const local = mesh.geometry.getAttribute("aMat");
    const kind = mesh.geometry.getAttribute("aKind");
    let mats = 0;
    let tops = 0;
    for (let i = 0; i < pos.count; i++) {
      if (kind.getX(i) > 0.5) {
        // The turntable's top: on the turntable, a hair above its baked top.
        tops++;
        const world = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
        const own = benchFrame(world);
        expect(Math.hypot(own.x - TURNTABLE_LOCAL.x, own.z - TURNTABLE_LOCAL.z)).toBeLessThan(TURNTABLE_LOCAL.r);
        expect(world.y).toBeGreaterThan(TURNTABLE_TOP);
        expect(world.y).toBeLessThan(TURNTABLE_TOP + 0.01);
        expect(local.getX(i)).toBeCloseTo(own.x, 5);
        expect(local.getY(i)).toBeCloseTo(own.z, 5);
        continue;
      }
      mats++;
      const world = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
      const own = benchFrame(world);
      expect(Math.abs(own.x)).toBeCloseTo(MAT_W / 2, 5);
      expect(Math.abs(own.z)).toBeCloseTo(MAT_D / 2, 5);
      expect(world.y).toBeGreaterThan(MAT_TOP);
      expect(world.y).toBeLessThan(MAT_TOP + 0.01);
      // What the shader calls the mat's own point is that corner, in the bench's frame.
      expect(local.getX(i)).toBeCloseTo(own.x, 5);
      expect(local.getY(i)).toBeCloseTo(own.z, 5);
    }
    expect(mats).toBe(6);
    expect(tops).toBeGreaterThan(100);
    // Facing up.
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
    expect(n.y).toBeCloseTo(1, 9);
    expect(benchPoint(1, 0, 0).length()).toBeCloseTo(1, 9);
    release();
  });

  it("puts the hover brackets on a blank and lets them fade without moving", () => {
    const { uniforms, release } = makeMat();
    setMatHover(uniforms, { x: 1.6, z: 0.9, turn: 0.1, halfW: 0.37, halfL: 0.4 }, 1);
    expect(uniforms.uHover.value.toArray()).toEqual([1.6, 0.9, 0.1, 1]);
    setMatHover(uniforms, null, 0.4);
    expect(uniforms.uHover.value.toArray()).toEqual([1.6, 0.9, 0.1, 0.4]);
    release();
  });
});
