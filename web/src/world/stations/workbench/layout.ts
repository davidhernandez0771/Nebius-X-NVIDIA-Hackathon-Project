// Where the bench's live parts go, local to the bench pivot (BENCH_PIVOT, the station's anchor). The
// numbers are the transforms of the bench parts in docs/design/blender/sant-cartridge.blend (the
// `bx_B_*` copies every baked GLB carries, already turned with the bench): the turntable the
// cartridge stands on, and the label printer's paper. Pure, so it is tested.
import * as THREE from "three";
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

/** bx_B_Paper: where the printer's paper lies, tilted on its tray, and its turn (three.js x, y, z, w). */
export const PAPER = {
  position: new THREE.Vector3(-2.7673, 3.6, -2.0377),
  quaternion: new THREE.Quaternion(-0.16894, -0.23823, -0.04212, 0.95548).normalize(),
};

/** The printed label: the label's aspect, a little smaller than the paper (0.8 x 0.5 m). */
export const PRINT_W = 0.62;
export const PRINT_H = 0.455;
/** Along the paper's own +z (out of the printer's slot): from inside the printer to resting on the tray. */
const SLIDE_FROM = -0.5;
const SLIDE_TO = 0.02;
/** Just over the baked paper, so the two don't fight. */
const LIFT = 0.004;

const _z = new THREE.Vector3();
const _y = new THREE.Vector3();

/** The printed label's pose at u (0: inside the printer, 1: out on the tray). Eased out, like a feed roller letting go. */
export function printPose(u: number, out = new THREE.Vector3()): THREE.Vector3 {
  const k = 1 - (1 - Math.min(1, Math.max(0, u))) ** 3;
  _z.set(0, 0, 1).applyQuaternion(PAPER.quaternion);
  _y.set(0, 1, 0).applyQuaternion(PAPER.quaternion);
  return out
    .copy(PAPER.position)
    .addScaledVector(_z, SLIDE_FROM + (SLIDE_TO - SLIDE_FROM) * k)
    .addScaledVector(_y, LIFT);
}

/** Seconds the label takes to come out. */
export const PRINT_S = 1.2;
