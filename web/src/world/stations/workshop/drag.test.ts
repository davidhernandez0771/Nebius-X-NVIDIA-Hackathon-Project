import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { BENCH_PIVOT, stop } from "../../scene/layout";
import { ABOVE_PORT, PLUGGED_Q } from "../../scene/plugSequence";
import { DRAG_PX, DROP_ZONE, MAGNET, backPose, cancel, drag, hiddenInstance, move, onPlane, press, rayHitsBox, release, resetDrag, settle, wasDrag } from "./drag";

const HUB = stop("Workshop intro");
const v = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);
/** A ray from the room view's camera toward a point. */
const rayTo = (p: THREE.Vector3) => ({ origin: v(HUB.position), dir: p.clone().sub(v(HUB.position)).normalize() });

describe("dragging a cartridge: the press", () => {
  beforeEach(() => resetDrag());

  it("stays a click until the pointer moves far enough, further for a finger", () => {
    press(3, 11, 100, 100, 1, "mouse");
    expect(move(1, 103, 102)).toBeNull();
    expect(drag.phase).toBe("press");
    expect(release(1)).toBe("click");
    expect(wasDrag()).toBe(false);
    expect(hiddenInstance()).toBe(-1);

    press(3, 11, 100, 100, 2, "touch");
    expect(move(2, 100 + DRAG_PX.mouse + 1, 100)).toBeNull();
    expect(move(2, 100 + DRAG_PX.touch + 1, 100)).toBe("start");
    expect(drag.phase).toBe("drag");
    expect(move(2, 140, 120)).toBe("move");
  });

  it("ignores other pointers (a second finger)", () => {
    press(3, 11, 100, 100, 1, "touch");
    expect(move(9, 300, 300)).toBeNull();
    expect(release(9)).toBeNull();
    expect(drag.phase).toBe("press");
  });

  it("drops on the machine, or floats back to the spiral; the spiral hides it until it settles", () => {
    press(30, 2, 0, 0, 1, "mouse");
    move(1, 50, 0);
    expect(hiddenInstance()).toBe(30);
    drag.over = true;
    expect(release(1)).toBe("drop");
    expect(drag.phase).toBe("drop");
    expect(hiddenInstance()).toBe(30);
    // The click that follows a drag's pointerup is not a click on the spiral.
    expect(wasDrag()).toBe(true);
    settle();
    expect(drag.phase).toBe("idle");
    expect(hiddenInstance()).toBe(-1);

    press(30, 2, 0, 0, 1, "mouse");
    expect(wasDrag()).toBe(false);
    move(1, 50, 0);
    drag.over = false;
    expect(release(1)).toBe("back");
    expect(drag.phase).toBe("back");
    expect(hiddenInstance()).toBe(30);
  });

  it("floats back on Escape or a cancelled pointer; a press just ends", () => {
    press(5, 20, 0, 0, 1, "mouse");
    expect(cancel()).toBeNull();
    expect(drag.phase).toBe("idle");
    press(5, 20, 0, 0, 1, "mouse");
    move(1, 40, 40);
    drag.over = true;
    expect(cancel()).toBe("back");
    expect(drag.phase).toBe("back");
    expect(drag.over).toBe(false);
  });
});

describe("dragging a cartridge: the 3D", () => {
  it("drops on the machine: the room view's rays at it hit, rays at the spiral and the bench don't", () => {
    const port = ABOVE_PORT.clone().setY(DROP_ZONE.center.y);
    for (const p of [DROP_ZONE.center, port]) {
      const r = rayTo(p);
      expect(rayHitsBox(r.origin, r.dir)).toBe(true);
    }
    for (const p of [new THREE.Vector3(0, 6, 0), v(BENCH_PIVOT.position).setY(3)]) {
      const r = rayTo(p);
      expect(rayHitsBox(r.origin, r.dir)).toBe(false);
    }
    // Behind the camera doesn't count.
    const r = rayTo(DROP_ZONE.center);
    expect(rayHitsBox(r.origin, r.dir.clone().negate())).toBe(false);
  });

  it("follows the pointer on a plane facing the camera through where it was grabbed", () => {
    const grab = new THREE.Vector3(1, 6, 2);
    const eye = v(HUB.position);
    const normal = v(HUB.target).sub(eye).normalize();
    const out = new THREE.Vector3();
    const dir = grab.clone().add(new THREE.Vector3(0.5, 0.3, 0)).sub(eye).normalize();
    expect(onPlane(eye, dir, grab, normal, out)).toBe(true);
    expect(out.clone().sub(grab).dot(normal)).toBeCloseTo(0, 6);
    // Parallel to the plane, or pointing away: nowhere.
    expect(onPlane(eye, normal.clone().negate(), grab, normal, out)).toBe(false);
  });

  it("over the machine, the cartridge waits above the port turned as it plugs in", () => {
    expect(MAGNET.position.distanceTo(ABOVE_PORT)).toBe(0);
    expect(MAGNET.quaternion.angleTo(PLUGGED_Q)).toBe(0);
  });

  it("floats back in an arc that starts where it was let go and ends in its slot", () => {
    const from = { position: new THREE.Vector3(4, 5, 6), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1) };
    const to = { position: new THREE.Vector3(1, 7, 1), quaternion: new THREE.Quaternion() };
    const out = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    backPose(from, to, 0, out);
    expect(out.position.distanceTo(from.position)).toBeLessThan(1e-9);
    expect(out.quaternion.angleTo(from.quaternion)).toBeLessThan(1e-6);
    backPose(from, to, 1, out);
    expect(out.position.distanceTo(to.position)).toBeLessThan(1e-9);
    expect(out.quaternion.angleTo(to.quaternion)).toBeLessThan(1e-6);
    // Lifted over the straight line halfway, and no jumps along the way.
    backPose(from, to, 0.5, out);
    expect(out.position.y).toBeGreaterThan((from.position.y + to.position.y) / 2);
    let prev = from.position.clone();
    for (let u = 0.01; u <= 1.0001; u += 0.01) {
      backPose(from, to, u, out);
      expect(out.position.distanceTo(prev)).toBeLessThan(0.25);
      prev = out.position.clone();
    }
  });
});
