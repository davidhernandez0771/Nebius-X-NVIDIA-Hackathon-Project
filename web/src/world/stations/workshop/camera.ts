// The workshop's camera, as a function of its dwell t (pure, so the rail's continuity tests cover it):
// first in from Blender's "Workshop intro" stop to the top of the spiral, then one step per job, each
// step facing that cartridge from outside the spiral, like a turntable you walk round. The scroll
// snaps to whole steps (stepper.ts); between them the camera glides round the helix.
import * as THREE from "three";
import { mixPose, smoother } from "../../core/rail";
import type { CameraPose } from "../../core/types";
import { stop } from "../../scene/layout";
import { N_ITEMS, stepPose } from "../../scene/spiral";

/** Viewport heights of scroll: the way in, then one step per job. */
export const ENTER_VH = 0.7;
export const STEP_VH = 0.3;
export const LENGTH_VH = ENTER_VH + STEP_VH * (N_ITEMS - 1);

/** Dwell t at display step d, and back. */
export const tOfStep = (d: number) => (ENTER_VH + d * STEP_VH) / LENGTH_VH;
export const stepOfT = (t: number) => (t * LENGTH_VH - ENTER_VH) / STEP_VH;

/** How far out the camera stands from a cartridge, browsing and in the detail view. */
const DIST = 7;
const DETAIL_DIST = 4.8;
/** In the detail view the cartridge sits right of centre, clear of the info block bottom left. */
const DETAIL_SIDE = 0.9;
/** Under the 14.4 m ceiling, and over the desks (the machine's body tops out at 4.4 m). */
const CAM_MAX_Y = 13.5;
const CAM_MIN_Y = 4.6;

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _o = new THREE.Vector3();

/** The cartridge at step d: its centre and the outward direction it faces (level). */
export function faceAt(d: number): { center: THREE.Vector3; out: THREE.Vector3 } {
  stepPose(d, _p, _q);
  _o.set(0, 0, 1).applyQuaternion(_q).setY(0).normalize();
  return { center: _p.clone(), out: _o.clone() };
}

function view(d: number, dist: number, rise: number, side = 0): CameraPose {
  const { center, out } = faceAt(d);
  // The view's right, looking in along -out: shifting both ends left puts the cartridge right.
  const rx = out.z;
  const rz = -out.x;
  const cx = center.x - rx * side;
  const cz = center.z - rz * side;
  const y = Math.min(CAM_MAX_Y, Math.max(CAM_MIN_Y, center.y + rise));
  return {
    position: [cx + out.x * dist, y, cz + out.z * dist],
    target: [cx, center.y - 0.15, cz],
    fov: 40,
  };
}

/** Browsing: the cartridge at step d, with its neighbours in view. */
export const stepView = (d: number) => view(d, DIST, 0.5);
/** The detail view: close on the cartridge at step d. */
export const detailView = (d: number) => view(d, DETAIL_DIST, 0.15, DETAIL_SIDE);

const INTRO = stop("Workshop intro");
const T0 = tOfStep(0);

export function workshopCamera(t: number): CameraPose {
  if (t < T0) return mixPose(INTRO, stepView(0), smoother(t / T0));
  return stepView(Math.min(N_ITEMS - 1, stepOfT(t)));
}
