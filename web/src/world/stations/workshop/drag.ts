// Dragging a cartridge from the spiral to the machine. A press on a cartridge stays a click (the old
// way: a job opens its detail view, a robot or a saved one plugs in) until the pointer moves far
// enough; then it is a drag: the cartridge leaves its slot and follows the pointer in 3D (Dragged.tsx),
// the machine's slot lights as a drop target, and over the machine it waits above the port. Let go
// there and it drops in (the plug-in, held: plugSequence.ts); anywhere else, or Escape, and it floats
// back to its slot. The state is mutated in place, like plug.ts; the geometry is pure, so it is tested.
import * as THREE from "three";
import { MACHINE_PIVOT } from "../../scene/layout";
import { ABOVE_PORT, PLUGGED_Q } from "../../scene/plugSequence";

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

/** Seconds a let-go cartridge takes to float back to its slot. */
export const BACK_S = 0.55;
/** How high the float back arcs over the straight line, at most (metres). */
const ARC = 0.6;

/** The float back at u (0: where it was let go, 1: in its slot): eased out, in a small arc. */
export function backPose(from: Pose, to: Pose, u: number, out: Pose): Pose {
  const k = Math.min(1, Math.max(0, u));
  const e = 1 - (1 - k) ** 3;
  out.position.lerpVectors(from.position, to.position, e);
  out.position.y += ARC * Math.min(1, from.position.distanceTo(to.position) / 3) * Math.sin(Math.PI * e);
  out.quaternion.slerpQuaternions(from.quaternion, to.quaternion, e);
  return out;
}
