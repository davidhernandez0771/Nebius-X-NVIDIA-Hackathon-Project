import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { BENCH_PIVOT, stop } from "../../scene/layout";
import { ABOVE_PORT, PLUGGED_Q } from "../../scene/plugSequence";
import { DRAG_PX, DROP_ZONE, MAGNET, cancel, drag, hiddenInstance, move, onPlane, press, rayHitsBox, release, resetDrag, settle, wasDrag } from "./drag";
import { CARRY_V, PICK, PICK_S, backStep, backTravelS, carryStep, gripOf, pickStep, type PickStep, type Pose } from "./drag";
import { solveArm, wristAbove } from "../../scene/armIk";
import { SPIRAL_R, cartridgeBody, clear } from "../../scene/collide";
import { slotAt } from "../../scene/layout";

const step = (): PickStep => ({ pose: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, grip: new THREE.Vector3(), closed: 0 });
const slotPoseOf = (k: number): Pose => { const s = slotAt(k); return { position: new THREE.Vector3(...s.position), quaternion: new THREE.Quaternion(...s.quaternion) }; };

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

  it("picks: the hand comes down onto the slot's top edge, closes, and the cartridge comes out clear of the spiral", () => {
    const slot = slotPoseOf(12);
    const hand = new THREE.Vector3(0.5, 7, 0.8);
    const out = step();
    pickStep(slot, hand, 0, out);
    expect(out.grip.distanceTo(hand)).toBeLessThan(1e-9);
    expect(out.closed).toBe(0);
    pickStep(slot, hand, PICK.reach + PICK.close * 0.999, out);
    expect(out.grip.distanceTo(gripOf(slot))).toBeLessThan(1e-9);
    expect(out.pose.position.distanceTo(slot.position)).toBe(0);
    expect(out.closed).toBeGreaterThan(0.99);
    pickStep(slot, hand, PICK_S, out);
    expect(Math.hypot(out.pose.position.x, out.pose.position.z)).toBeGreaterThanOrEqual(SPIRAL_R);
    expect(out.pose.quaternion.equals(slot.quaternion)).toBe(true);
    // The fingertips stay on the edge as it comes out, and nothing jumps.
    let prev = pickStep(slot, hand, 0, step()).grip.clone();
    for (let t = 0.01; t <= PICK_S; t += 0.01) {
      pickStep(slot, hand, t, out);
      expect(out.grip.distanceTo(prev)).toBeLessThan(0.3);
      prev = out.grip.clone();
      if (t > PICK.reach + PICK.close) expect(out.grip.distanceTo(gripOf(out.pose))).toBeLessThan(1e-9);
    }
  });

  it("carries: at most CARRY_V a second, within the arm's reach, never into a table or the spiral", () => {
    const q = new THREE.Quaternion();
    let at = new THREE.Vector3(2, 7, -5);
    const out = new THREE.Vector3();
    // Toward a point down inside the bench, then across into the spiral, then far out of reach.
    for (const target of [new THREE.Vector3(-9, 1, -0.5), new THREE.Vector3(0, 5, 0), new THREE.Vector3(18, 6, 9)]) {
      for (let i = 0; i < 90; i++) {
        carryStep(at, target, q, 1 / 60, out);
        expect(out.distanceTo(at)).toBeLessThanOrEqual(CARRY_V / 60 + 0.25 + 1e-6);
        expect(clear(out, cartridgeBody(1))).toBe(true);
        expect(solveArm(wristAbove(gripOf({ position: out, quaternion: q }))).reachable).toBe(true);
        at = out.clone();
      }
    }
  });

  it("puts back: round the outside of the spiral to its slot, in, and lets go", () => {
    const slot = slotPoseOf(5);
    const from = { position: new THREE.Vector3(6, 7, 3), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1) };
    const out = step();
    const first = backStep(from, slot, 0, out);
    expect(out.pose.position.distanceTo(from.position)).toBeLessThan(1e-6);
    expect(out.closed).toBe(1);
    let prev = out.pose.position.clone();
    const travel = backTravelS(from.position, slot);
    for (let t = 0.01; t < first.total + 0.05; t += 0.01) {
      const r = backStep(from, slot, t, out);
      expect(out.pose.position.distanceTo(prev)).toBeLessThan(0.3);
      prev = out.pose.position.clone();
      if (t < travel) expect(Math.hypot(out.pose.position.x, out.pose.position.z)).toBeGreaterThanOrEqual(SPIRAL_R - 1e-6);
      if (r.done) break;
    }
    const end = backStep(from, slot, first.total, out);
    expect(end.done).toBe(true);
    expect(out.pose.position.distanceTo(slot.position)).toBeLessThan(1e-9);
    expect(out.closed).toBe(0);
  });
});
