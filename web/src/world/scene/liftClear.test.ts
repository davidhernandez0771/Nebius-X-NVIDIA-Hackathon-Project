// The user saw the rising spiral pass through the arm. Now the arm takes the cartridge into the spiral's
// hollow core before the spiral moves, and the spiral moves only while the arm is clear (lift.ts
// clearOfSpiral). These sweep the lift (up for a pick or a click, down for a put-back: the same
// positions in reverse) and check every one of the spiral's cartridges and its band against the arm's
// segments and the cartridge it holds, at every step: no overlap anywhere.
import * as THREE from "three";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { describe, expect, it } from "vitest";
import { pulledPose, gripOf, type Pose } from "../stations/workshop/drag";
import { armPoints, solveArm, wristAbove } from "./armIk";
import { HELIX } from "./layout";
import { CORE_CLEAR, clearOfSpiral, liftOffset } from "./lift";
import { PHASE, cartridgePose, liftAt } from "./plugSequence";
import { bandGeometry, ribbonCurve } from "./Ribbon";

const HALF = new THREE.Vector3(1.15, 1.25, 0.17);
const box = (p: THREE.Vector3, q: THREE.Quaternion) => new OBB(p.clone(), HALF.clone(), new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)));
/** The arm's segments' thickness round their lines (lift.ts LINK_R's, as built in Arm.tsx). */
const LINK_R = [0.45, 0.36, 0.5];

const band = (() => {
  const { band } = bandGeometry(ribbonCurve());
  const pos = band.getAttribute("position");
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i));
  return pts;
})();
const LEVELS = Array.from({ length: 41 }, (_, i) => i / 40);
const _a = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Whether the spiral, lifted to `level`, touches the arm at `points` or the cartridge it holds. */
function touches(level: number, points: THREE.Vector3[], held: Pose, except: number): string | null {
  const up = liftOffset(level);
  const mine = box(held.position, held.quaternion);
  for (const s of HELIX) {
    if (s.index === except) continue;
    const other = box(new THREE.Vector3(s.position[0], s.position[1] + up, s.position[2]), new THREE.Quaternion(...s.quaternion));
    if (other.intersectsOBB(mine)) return `slot ${s.index} hits the cartridge`;
    for (let k = 0; k < 3; k++)
      for (let i = 0; i <= 12; i++) {
        _a.lerpVectors(points[k], points[k + 1], i / 12);
        if (other.clampPoint(_a, _c).distanceTo(_a) < LINK_R[k]) return `slot ${s.index} hits the arm (segment ${k})`;
      }
  }
  for (const b of band) {
    _c.set(b.x, b.y + up, b.z);
    if (mine.containsPoint(_c)) return "the band runs through the cartridge";
    for (let k = 0; k < 3; k++)
      for (let i = 0; i <= 12; i++) {
        _a.lerpVectors(points[k], points[k + 1], i / 12);
        if (_a.distanceTo(_c) < LINK_R[k]) return `the band hits the arm (segment ${k})`;
      }
  }
  return null;
}

describe("the spiral never passes through the arm", () => {
  it("keeps its band out of its hollow core, round the empty places too", () => {
    for (const b of band) expect(Math.hypot(b.x, b.z)).toBeGreaterThan(CORE_CLEAR);
  });

  it("lifts (and comes back down) round a picked cartridge waiting in the core, for every slot", () => {
    for (const s of HELIX) {
      const slot: Pose = { position: new THREE.Vector3(...s.position), quaternion: new THREE.Quaternion(...s.quaternion) };
      const held = pulledPose(slot, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
      const points = armPoints(solveArm(wristAbove(gripOf(held))));
      expect(clearOfSpiral(points, held), `slot ${s.index}`).toBe(true);
      for (const level of LEVELS) expect(touches(level, points, held, s.index), `slot ${s.index} at lift ${level}`).toBeNull();
    }
  });

  it("lifts round a clicked cartridge on its way to the machine, at every step of the lift", () => {
    for (const s of HELIX) {
      for (let u = PHASE.lift[0]; u <= PHASE.lift[1] + 1e-9; u += 0.02) {
        const c = cartridgePose(s.index, u);
        const points = armPoints(solveArm(wristAbove(gripOf(c))));
        expect(clearOfSpiral(points, c), `slot ${s.index} u=${u.toFixed(2)}`).toBe(true);
        expect(touches(liftAt(u), points, c, s.index), `slot ${s.index} u=${u.toFixed(2)}`).toBeNull();
      }
    }
  });

  it("only calls the arm clear when it is inside the core, and not when it reaches out through the ring", () => {
    const out = armPoints(solveArm(new THREE.Vector3(4.5, 6, 0)));
    expect(clearOfSpiral(out)).toBe(false);
    const inCore = armPoints(solveArm(new THREE.Vector3(0.6, 6, 0)));
    expect(clearOfSpiral(inCore)).toBe(true);
    // A cartridge held outside the core is not clear either, however the arm stands.
    const q = new THREE.Quaternion();
    expect(clearOfSpiral(inCore, { position: new THREE.Vector3(0, 5, CORE_CLEAR + 0.2), quaternion: q })).toBe(false);
  });
});
