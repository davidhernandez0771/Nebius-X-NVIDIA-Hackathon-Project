// Where the bench's live parts go, local to the bench pivot (BENCH_PIVOT, the station's anchor). The
// numbers are the transforms of the bench parts in docs/design/blender/sant-cartridge.blend (the
// `bx_B_*` copies every baked GLB carries, already turned with the bench): the turntable the
// cartridge stands on, and the label printer's slot. Pure, so it is tested.
import * as THREE from "three";
import { LABEL_ASPECT } from "../../scene/labels";
import { BENCH_PIVOT, stopFrom } from "../../scene/layout";

/** bx_B_Turntable's centre; its top (with the teal ring) is TURNTABLE_TOP. */
export const TURNTABLE = new THREE.Vector3(-0.1878, 3.37, 0.3532);
export const TURNTABLE_TOP = 3.44;

/** The bench's cartridge is smaller than the spiral's, so the edit shot frames all of it. */
export const BENCH_SCALE = 0.62;
/** Half a cartridge's height at scale 1 (cartridge.glb's body: ±1.25 m). */
const HALF_H = 1.25;

/** The edit camera, local to the anchor (Blender's "Workbench edit"). */
export const EDIT_VIEW = stopFrom(BENCH_PIVOT.position, "Workbench edit");

/** The cartridge on the turntable: standing on it, its label turned to the edit camera. */
export function benchCartridge(): { position: THREE.Vector3; yaw: number } {
  const eye = EDIT_VIEW.position;
  const yaw = Math.atan2(eye[0] - TURNTABLE.x, eye[2] - TURNTABLE.z);
  return { position: new THREE.Vector3(TURNTABLE.x, TURNTABLE_TOP + HALF_H * BENCH_SCALE, TURNTABLE.z), yaw };
}

/**
 * bx_B_PrinterSlot: the label printer's slot, on its front face. Blender's paper (bx_B_Paper) leans
 * back from it, so from the edit camera a label lying on it would be nearly edge-on; the printed
 * label feeds straight out of the slot instead and droops toward the camera, like a strip of paper.
 */
export const SLOT = new THREE.Vector3(-2.6546, 3.61, -2.2496);
/** The printer faces the way the bench does. */
const FEED = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), BENCH_PIVOT.yaw);
/** Enough to face the camera, not so much that its far edge reaches the bench top (0.27 m below the slot). */
const DROOP = 0.4;
export const PRINT_QUATERNION = FEED.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), DROOP));

/** The printed label: the label's aspect, about as wide as the slot (0.9 m). */
export const PRINT_W = 0.8;
export const PRINT_H = PRINT_W / LABEL_ASPECT;
/** Along the label's own +z, from the slot: from all inside the printer to all out. */
const SLIDE_FROM = -(PRINT_H / 2 + 0.03);
const SLIDE_TO = PRINT_H / 2 + 0.01;

const _z = new THREE.Vector3();

/** The printed label's centre at u (0: inside the printer, 1: out). Eased out, like a feed roller letting go. */
export function printPose(u: number, out = new THREE.Vector3()): THREE.Vector3 {
  const k = 1 - (1 - Math.min(1, Math.max(0, u))) ** 3;
  _z.set(0, 0, 1).applyQuaternion(PRINT_QUATERNION);
  return out.copy(SLOT).addScaledVector(_z, SLIDE_FROM + (SLIDE_TO - SLIDE_FROM) * k);
}

/** Seconds the label takes to come out. */
export const PRINT_S = 1.2;
