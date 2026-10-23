// Dragging a cartridge from the spiral to the machine. A press on a cartridge stays a click (the old
// way: a job opens its detail view, a robot or a saved one plugs in) until the pointer moves far
// enough; then it is a drag, and the arm in the middle of the spiral does the carrying (Dragged.tsx
// choreographs it, Arm.tsx follows): the spiral parts, the arm takes the cartridge out of its slot by
// its top edge and carries it after the pointer, over tables and round the spiral, never through them
// (collide.ts). Over the machine the slot lights as a drop target and the cartridge waits above the
// port. Let go there and the arm lowers it in (the plug-in, held: plugSequence.ts); anywhere else, or
// Escape, and the arm puts it back in its slot. The state is mutated in place, like plug.ts; the
// geometry and the choreography are pure, so they are tested.
import * as THREE from "three";
import { GRIP_DEPTH, clampReach } from "../../scene/armIk";
import { MAST_R, SPIRAL_R, cartridgeBody, resolve, sweep, type Body } from "../../scene/collide";
import { LIFT_S } from "../../scene/lift";
import { MACHINE_PIVOT } from "../../scene/layout";
import { ABOVE_PORT, PLUGGED_Q, pullAt, pullOf, type Pull } from "../../scene/plugSequence";

export type PointerKind = "mouse" | "touch" | "pen";

/** Pixels a press moves before it is a drag: a finger wobbles more than a mouse. */
export const DRAG_PX: Record<PointerKind, number> = { mouse: 6, pen: 6, touch: 12 };

/**
 * idle; press (down on a cartridge, still a click); drag (following the pointer); drop (let go over
 * the machine, handing over to the plug-in); back (floating back to its slot).
 */
export type DragPhase = "idle" | "press" | "drag" | "drop" | "back";

export const drag = {
  phase: "idle" as DragPhase,
  /** The spiral instance (Helix) and the spiral slot it stands in. */
  instance: -1,
  slot: -1,
  pointerId: -1,
  kind: "mouse" as PointerKind,
  x0: 0,
  y0: 0,
  /** The pointer now (client px). */
  x: 0,
  y: 0,
  /** Over the machine: a release drops it in. Written by Dragged.tsx every frame of a drag. */
  over: false,
  /** The press became a drag: the click the browser sends after its pointerup is not a click. */
  dragged: false,
};

const fns = new Set<() => void>();
/** Hears when the phase changes or the drop target lights or goes out (the overlays). */
export function subscribeDrag(fn: () => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}
const notify = () => fns.forEach((fn) => fn());

function setPhase(p: DragPhase): void {
  if (drag.phase === p) return;
  drag.phase = p;
  notify();
}

/** Set whether the pointer is over the machine (Dragged.tsx). */
export function setOver(on: boolean): void {
  if (drag.over === on) return;
  drag.over = on;
  notify();
}

/** A press on a cartridge. Ignored while one is still dropping or floating back. */
export function press(instance: number, slot: number, x: number, y: number, pointerId: number, kind: PointerKind): void {
  if (drag.phase === "drop" || drag.phase === "back") return;
  Object.assign(drag, { instance, slot, pointerId, kind, x0: x, y0: y, x, y, over: false, dragged: false });
  setPhase("press");
}

/** The pointer moved: "start" when this move made the press a drag, "move" during one, else null. */
export function move(pointerId: number, x: number, y: number): "start" | "move" | null {
  if (pointerId !== drag.pointerId) return null;
  if (drag.phase === "drag") {
    drag.x = x;
    drag.y = y;
    return "move";
  }
  if (drag.phase !== "press" || Math.hypot(x - drag.x0, y - drag.y0) < DRAG_PX[drag.kind]) return null;
  drag.x = x;
  drag.y = y;
  drag.dragged = true;
  setPhase("drag");
  return "start";
}

/** The pointer came up: a click (still a press), a drop (over the machine) or back to the spiral. */
export function release(pointerId: number): "click" | "drop" | "back" | null {
  if (pointerId !== drag.pointerId) return null;
  if (drag.phase === "press") {
    setPhase("idle");
    return "click";
  }
  if (drag.phase !== "drag") return null;
  const to = drag.over ? "drop" : "back";
  setPhase(to);
  return to;
}

/** Escape, a cancelled pointer, the room leaving view: a drag floats back, a press just ends. */
export function cancel(): "back" | null {
  if (drag.phase === "press") {
    setPhase("idle");
    return null;
  }
  if (drag.phase !== "drag") return null;
  setOver(false);
  setPhase("back");
  return "back";
}

/** The drop has been handed to the machine, or it is back in its slot. */
export function settle(): void {
  drag.over = false;
  setPhase("idle");
}

/** The instance the spiral leaves empty: the one in the hand, dropping or floating back. */
export function hiddenInstance(): number {
  return drag.phase === "drag" || drag.phase === "drop" || drag.phase === "back" ? drag.instance : -1;
}

/** Whether the last press became a drag (its pointerup's click is not a click). */
export const wasDrag = () => drag.dragged;

/** Whether a cartridge is in the hand now. */
export const dragging = () => drag.phase === "drag";

export function resetDrag(): void {
  Object.assign(drag, { phase: "idle", instance: -1, slot: -1, pointerId: -1, kind: "mouse", over: false, dragged: false });
}

// ---------------------------------------------------------------- the 3D

/**
 * Where a drop counts: a box round the machine and its desk, turned with it (the same box takes the
 * room view's click on the machine, HubTags.tsx).
 */
export const DROP_ZONE = {
  center: new THREE.Vector3(MACHINE_PIVOT.position[0], MACHINE_PIVOT.position[1] + 2.4, MACHINE_PIVOT.position[2]),
  half: new THREE.Vector3(3.75, 2.75, 2.25),
  yaw: MACHINE_PIVOT.yaw,
};

/** Over the machine the cartridge waits above the port, turned as it plugs in. */
export const MAGNET = { position: ABOVE_PORT as THREE.Vector3, quaternion: PLUGGED_Q };

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _inv = new THREE.Quaternion();

/** Whether a ray (origin, unit direction) passes through a turned box, in front of the origin. */
export function rayHitsBox(origin: THREE.Vector3, dir: THREE.Vector3, box = DROP_ZONE): boolean {
  _inv.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -box.yaw);
  _o.copy(origin).sub(box.center).applyQuaternion(_inv);
  _d.copy(dir).applyQuaternion(_inv);
  let near = -Infinity;
  let far = Infinity;
  for (const a of ["x", "y", "z"] as const) {
    const o = _o[a];
    const d = _d[a];
    const h = box.half[a];
    if (Math.abs(d) < 1e-12) {
      if (o < -h || o > h) return false;
      continue;
    }
    let t0 = (-h - o) / d;
    let t1 = (h - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return false;
  }
  return far >= 0;
}

/** Where a ray meets the plane through `point` with `normal`, into `out`; false if it never does ahead. */
export function onPlane(origin: THREE.Vector3, dir: THREE.Vector3, point: THREE.Vector3, normal: THREE.Vector3, out: THREE.Vector3): boolean {
  const den = dir.dot(normal);
  if (Math.abs(den) < 1e-6) return false;
  const t = _o.copy(point).sub(origin).dot(normal) / den;
  if (t <= 0) return false;
  out.copy(origin).addScaledVector(dir, t);
  return true;
}

export interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

// ---------------------------------------------------------------- the arm's part (Arm.tsx follows)

/** The fingertips on a cartridge at `pose` (scale 1): just under the middle of its top edge. */
export function gripOf(pose: Pose, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(0, HALF_H - GRIP_DEPTH, 0).applyQuaternion(pose.quaternion).add(pose.position);
}

/** The cartridge's centre under fingertips at `grip`, turned by `q`. */
export function centreUnder(grip: THREE.Vector3, q: THREE.Quaternion, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(0, -(HALF_H - GRIP_DEPTH), 0).applyQuaternion(q).add(grip);
}

/**
 * Seconds of the pick: the hand reaches the cartridge's top edge, the fingers close, it comes out of
 * its slot past the spiral's ring (plugSequence.ts pullOf, the plug-in's own way out). Then the spiral
 * rises out of the way (lift.ts) and the carry starts once it is mostly up (Dragged.tsx).
 */
export const PICK = { reach: 0.42, close: 0.14, pull: 0.36 } as const;
export const PICK_S = PICK.reach + PICK.close + PICK.pull;
/** The carry starts once the spiral is this far up (its ring is no longer in the way). */
export const CARRY_FROM_LIFT = 0.6;

const Y = new THREE.Vector3(0, 1, 0);

/** A slot's cartridge part of the way (k, 0–1) out of its slot, turned with it if its way out goes round. */
function pulledAt(slot: Pose, pull: Pull, k: number, out: Pose): Pose {
  if (k <= 0) out.position.copy(slot.position);
  else pullAt(pull, k, out.position);
  out.quaternion.setFromAxisAngle(Y, wrap(pull.a1 - pull.a0) * smooth(k)).multiply(slot.quaternion);
  return out;
}

/** A cartridge's slot pose pulled clear of the spiral: out past its ring, up a little (pullOf). */
export function pulledPose(slot: Pose, out: Pose): Pose {
  return pulledAt(slot, pullOf(slot.position), 1, out);
}

export interface PickStep {
  /** Where the cartridge is (in its slot until the fingers have it). */
  pose: Pose;
  /** Where the fingertips are, and how closed. */
  grip: THREE.Vector3;
  closed: number;
}

const smooth = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/**
 * The pick at t seconds: the fingertips go from where the hand was (`hand`) to the slot's top edge
 * (from above, coming down onto it at the end), close, then the cartridge comes out with them.
 */
export function pickStep(slot: Pose, hand: THREE.Vector3, t: number, out: PickStep): PickStep {
  const top = gripOf(slot, _g0);
  if (t < PICK.reach) {
    const k = smooth(t / PICK.reach);
    out.pose.position.copy(slot.position);
    out.pose.quaternion.copy(slot.quaternion);
    out.grip.lerpVectors(hand, top, k);
    // Down onto the edge from a little above, not sideways through the cartridge's top.
    out.grip.y += 0.45 * Math.sin(Math.PI * Math.min(1, k * 1.15));
    out.closed = 0;
    return out;
  }
  if (t < PICK.reach + PICK.close) {
    out.pose.position.copy(slot.position);
    out.pose.quaternion.copy(slot.quaternion);
    out.grip.copy(top);
    out.closed = smooth((t - PICK.reach) / PICK.close);
    return out;
  }
  pulledAt(slot, pullOf(slot.position), smooth((t - PICK.reach - PICK.close) / PICK.pull), out.pose);
  gripOf(out.pose, out.grip);
  out.closed = 1;
  return out;
}

/** Metres a second the arm carries a cartridge at, at most, and how fast it catches up (1/s). */
export const CARRY_V = 11;
export const CARRY_FOLLOW = 9;

/**
 * One frame of the carry: toward `target`, eased and no faster than CARRY_V, in short resolved steps
 * (over tables, along walls: collide.ts), the fingertips kept within the arm's reach. `spiralR`: what
 * it keeps clear of in the middle (the spiral's ring while it stands, only the mast once it has lifted).
 */
export function carryStep(from: THREE.Vector3, target: THREE.Vector3, q: THREE.Quaternion, dt: number, out: THREE.Vector3, spiralR = SPIRAL_R, body: Body = BODY): THREE.Vector3 {
  // Within reach: the fingertips' point pulled in toward the axis if need be.
  clampReach(gripOf({ position: target, quaternion: q }, _g1), _g1);
  centreUnder(_g1, q, _to);
  resolve(_to, body, undefined, spiralR);
  const k = 1 - Math.exp(-dt * CARRY_FOLLOW);
  _step.copy(_to).sub(from).multiplyScalar(k).clampLength(0, CARRY_V * dt);
  return sweep(from, _step.add(from), body, out, 0.25, spiralR);
}

/**
 * Seconds of the put-back: carried round to just outside its slot (by the distance) while the spiral is
 * still up; held there while the spiral comes back down round it; pushed in; let go.
 */
export const BACK = { min: 0.55, max: 1.5, perM: 0.11, descend: LIFT_S + 0.1, insert: 0.32, open: 0.16 } as const;
export const backTravelS = (from: THREE.Vector3, slot: Pose) => Math.min(BACK.max, Math.max(BACK.min, from.distanceTo(slot.position) * BACK.perM));

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface BackStep {
  step: PickStep;
  total: number;
  done: boolean;
  /** Whether the spiral should be up (1) or coming down (0) at this point. */
  liftWant: number;
}

/**
 * The put-back at t seconds after letting go at `from`: round the axis to just outside the slot
 * (bearing the short way, the height eased, clear of the mast and the furniture), turning to face as
 * it will in the slot; the spiral comes back down; then back in along its way out; then the fingers
 * open. Done when t passes the returned `total`.
 */
export function backStep(from: Pose, slot: Pose, t: number, out: PickStep): BackStep {
  const travel = backTravelS(from.position, slot);
  const total = travel + BACK.descend + BACK.insert + BACK.open;
  const pull = pullOf(slot.position);
  const outside = pulledAt(slot, pull, 1, _pulled);
  if (t < travel) {
    const k = smooth(t / travel);
    const a0 = Math.atan2(from.position.x, from.position.z);
    const a1 = Math.atan2(outside.position.x, outside.position.z);
    const r0 = Math.max(MAST_R, Math.hypot(from.position.x, from.position.z));
    const r1 = Math.hypot(outside.position.x, outside.position.z);
    const a = a0 + wrap(a1 - a0) * k;
    const r = r0 + (r1 - r0) * k;
    const y = from.position.y + (outside.position.y - from.position.y) * k;
    out.pose.position.set(r * Math.sin(a), y, r * Math.cos(a));
    out.pose.quaternion.slerpQuaternions(from.quaternion, outside.quaternion, smooth(t / (travel * 0.8)));
    resolve(out.pose.position, BODY, undefined, MAST_R);
    out.closed = 1;
  } else if (t < travel + BACK.descend) {
    out.pose.position.copy(outside.position);
    out.pose.quaternion.copy(outside.quaternion);
    out.closed = 1;
  } else if (t < travel + BACK.descend + BACK.insert) {
    pulledAt(slot, pull, 1 - smooth((t - travel - BACK.descend) / BACK.insert), out.pose);
    out.closed = 1;
  } else {
    out.pose.position.copy(slot.position);
    out.pose.quaternion.copy(slot.quaternion);
    out.closed = 1 - smooth((t - travel - BACK.descend - BACK.insert) / BACK.open);
  }
  gripOf(out.pose, out.grip);
  // Letting go, the hand lifts off the edge.
  if (out.closed < 1) out.grip.y += 0.3 * (1 - out.closed);
  return { step: out, total, done: t >= total, liftWant: t < travel ? 1 : 0 };
}

/** Half a spiral cartridge's height (cartridge.glb: ±1.25 m). */
const HALF_H = 1.25;
const BODY = cartridgeBody(1);
const _g0 = new THREE.Vector3();
const _g1 = new THREE.Vector3();
const _to = new THREE.Vector3();
const _step = new THREE.Vector3();
const _pulled: Pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
