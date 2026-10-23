// The arm in the middle of the spiral, as numbers: its sizes, and where its joints go to put the
// wrist on a point. It stands on the spiral's axis; a mast rises from the pedestal to the shoulder
// (its height is free, within the mast's travel), the arm turns about the axis, and a shoulder, an
// elbow and a telescoping forearm reach out in the vertical plane it faces. The hand hangs straight
// down from the wrist, so it can take a cartridge by its top edge. Pure, so it is tested.
import * as THREE from "three";

export const ARM = {
  /** The pedestal's top, and the mast's foot above it (the base's height). */
  floor: -0.22,
  foot: 0.55,
  /** Upper arm and forearm, metres, and how far the forearm's sleeve slides out. */
  upper: 2.4,
  fore: 2.0,
  extMax: 1.9,
  /** Wrist to the point between the fingertips (the hand hangs down from the wrist). */
  hand: 0.62,
  /** The mast's travel: the shoulder stands this far above the foot, at least and at most. */
  topMin: 1.2,
  topMax: 12.6,
} as const;

/** Fingertips below a cartridge's top edge when they hold it (the palm rests just above it). */
export const GRIP_DEPTH = 0.18;

/** The shoulder's lowest and highest heights (world y). */
export const SHOULDER_MIN = ARM.floor + ARM.foot + ARM.topMin;
export const SHOULDER_MAX = ARM.floor + ARM.foot + ARM.topMax;
/** A comfortable stretch (shoulder to wrist): the elbow stays well bent, up above the line. */
export const COMFORT = 0.78 * (ARM.upper + ARM.fore);
/** Hanging nearly straight down from high above: the elbow stays close to the axis (the idle pose, inside the spiral). */
export const HANG = 0.96 * (ARM.upper + ARM.fore);
/** The longest stretch the arm makes, its sleeve all the way out (short of locking straight). */
export const STRETCH_MAX = 0.98 * (ARM.upper + ARM.fore + ARM.extMax);

export interface ArmPose {
  /** About the axis: the arm's reach is its local +z (atan2(x, z) of the wrist). */
  yaw: number;
  /** The shoulder's height (world y): the mast's top. */
  shoulderY: number;
  /** Shoulder pitch from straight up toward the reach, elbow bend on top of it, wrist so the hand hangs down. */
  shoulder: number;
  elbow: number;
  wrist: number;
  /** The forearm's sleeve, out (metres). */
  ext: number;
  /** False when the wrist was out of reach: the arm points at it, stretched. */
  reachable: boolean;
}

export const armPose = (): ArmPose => ({ yaw: 0, shoulderY: SHOULDER_MIN, shoulder: 0, elbow: 0, wrist: Math.PI, ext: 0, reachable: true });

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/**
 * The joints that put the wrist on `wrist` (world). The mast lifts the shoulder above the wrist by
 * as much as a comfortable stretch allows (high above a near point, level with a far one), the
 * sleeve slides out only when the arm alone is too short, and the elbow bends upward.
 */
export function solveArm(wrist: THREE.Vector3, out: ArmPose = armPose(), stretch = COMFORT): ArmPose {
  const r = Math.hypot(wrist.x, wrist.z);
  out.yaw = r > 1e-6 ? Math.atan2(wrist.x, wrist.z) : out.yaw;
  // High enough over the wrist for a comfortable stretch (a little, at least, so the arm reaches down).
  const lift = r < stretch ? Math.sqrt(stretch * stretch - r * r) : 0.25;
  out.shoulderY = clamp(wrist.y + Math.max(0.25, lift), SHOULDER_MIN, SHOULDER_MAX);
  const dy = wrist.y - out.shoulderY;
  let len = Math.hypot(r, dy);
  out.reachable = len <= STRETCH_MAX + 1e-6;
  len = Math.min(len, STRETCH_MAX);
  out.ext = clamp(len - 0.98 * (ARM.upper + ARM.fore), 0, ARM.extMax);
  const u = ARM.upper;
  const f = ARM.fore + out.ext;
  // Not closer than the folded arm can bring it.
  len = Math.max(len, Math.abs(u - f) + 0.05);
  // The line to the wrist, from straight up toward the reach.
  const phi = Math.atan2(r, dy);
  const alpha = Math.acos(clamp((u * u + len * len - f * f) / (2 * u * len), -1, 1));
  const beta = Math.acos(clamp((u * u + f * f - len * len) / (2 * u * f), -1, 1));
  // Elbow up: the upper arm leans less than the line, the forearm bends on down to the wrist.
  out.shoulder = phi - alpha;
  out.elbow = Math.PI - beta;
  out.wrist = Math.PI - out.shoulder - out.elbow;
  return out;
}

/** Points along the arm (world): the shoulder, the elbow, the wrist, the fingertips. */
export function armPoints(p: ArmPose, out: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]): THREE.Vector3[] {
  const sx = Math.sin(p.yaw);
  const sz = Math.cos(p.yaw);
  const at = (o: THREE.Vector3, fwd: number, y: number) => o.set(sx * fwd, y, sz * fwd);
  const a1 = p.shoulder;
  const a2 = p.shoulder + p.elbow;
  const e = [ARM.upper * Math.sin(a1), p.shoulderY + ARM.upper * Math.cos(a1)];
  const f = ARM.fore + p.ext;
  const w = [e[0] + f * Math.sin(a2), e[1] + f * Math.cos(a2)];
  at(out[0], 0, p.shoulderY);
  at(out[1], e[0], e[1]);
  at(out[2], w[0], w[1]);
  at(out[3], w[0], w[1] - ARM.hand);
  return out;
}

/** The wrist above a point between the fingertips (the hand hangs straight down). */
export const wristAbove = (grip: THREE.Vector3, out = new THREE.Vector3()) => out.copy(grip).setY(grip.y + ARM.hand);

/**
 * Whether a grip point is within reach, and if not the nearest one that is (same height and bearing,
 * pulled in toward the axis). The mast's travel bounds the height a far point can be taken at.
 */
export function clampReach(grip: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  out.copy(grip);
  const wy = grip.y + ARM.hand;
  const dy = wy < SHOULDER_MIN ? SHOULDER_MIN - wy : wy > SHOULDER_MAX ? wy - SHOULDER_MAX : 0.25;
  const rMax = Math.sqrt(Math.max(0, STRETCH_MAX * STRETCH_MAX - dy * dy)) * 0.995;
  const r = Math.hypot(grip.x, grip.z);
  if (r > rMax && r > 1e-6) {
    out.x *= rMax / r;
    out.z *= rMax / r;
  }
  return out;
}
