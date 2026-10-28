// Where the bench's live parts go, local to the bench pivot (BENCH_PIVOT, the station's anchor). The
// numbers are the transforms of the bench parts in docs/design/blender/sant-cartridge.blend (the
// `bx_B_*` copies every baked GLB carries, already turned with the bench): the turntable the
// cartridge stands on, and the label printer's slot. Pure, so it is tested.
import * as THREE from "three";
import { LABEL_ASPECT } from "../../scene/labels";
import { BENCH_PIVOT, SPARE, stopFrom } from "../../scene/layout";

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

const ANCHOR = new THREE.Vector3(...BENCH_PIVOT.position);
const UP = new THREE.Vector3(0, 1, 0);

/** The turntable's cartridge in world space, as the room view shows it (one of the spiral's instances). */
export function benchMatrix(out = new THREE.Matrix4()): THREE.Matrix4 {
  const { position, yaw } = benchCartridge();
  return out.compose(position.add(ANCHOR), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3().setScalar(BENCH_SCALE));
}

/** Seconds a saved cartridge takes from the turntable to its place on the spiral. */
export const FLIGHT_S = 1.4;
/** Straight up off the turntable first (metres), then in to the spiral from outside its place. */
const LIFT = 2.4;
const APPROACH = 1.8;

export interface FlightPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: number;
}

const _m = new THREE.Matrix4();
const _p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * A save's flight, world space: up off the turntable, across the room, and into its empty place on the
 * spiral (layout.ts SPARE[place]) from outside, along the way its label faces. One eased cubic Bezier;
 * it turns and grows to the spiral's size on the way.
 */
export function flightPose(place: number, u: number, out: FlightPose): FlightPose {
  const slot = SPARE[place];
  if (!slot) throw new Error(`world: no empty place ${place} on the spiral`);
  const k = Math.min(1, Math.max(0, u));
  const e = k * k * (3 - 2 * k);
  benchMatrix(_m).decompose(_p[0], _q0, _s);
  _q1.set(...slot.quaternion);
  _p[3].set(...slot.position);
  _p[1].copy(_p[0]).addScaledVector(UP, LIFT);
  _p[2].set(0, 0, 1).applyQuaternion(_q1).multiplyScalar(APPROACH).add(_p[3]).addScaledVector(UP, 0.6);
  const a = 1 - e;
  out.position
    .copy(_p[0])
    .multiplyScalar(a * a * a)
    .addScaledVector(_p[1], 3 * a * a * e)
    .addScaledVector(_p[2], 3 * a * e * e)
    .addScaledVector(_p[3], e * e * e);
  out.quaternion.slerpQuaternions(_q0, _q1, e);
  out.scale = BENCH_SCALE + (slot.scale - BENCH_SCALE) * e;
  return out;
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

// ---- The making, stage by stage (draft.ts STAGES) ----

/** The bench's turn (its parts are turned by it, round the anchor): its own x runs along the front. */
const YAW = new THREE.Quaternion().setFromAxisAngle(UP, BENCH_PIVOT.yaw);
const UNYAW = YAW.clone().invert();

/** A point in the bench's own frame (x along its front, z toward its front edge), local to the anchor. */
export const benchPoint = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(YAW);
/** A local point in the bench's own frame. */
export const benchFrame = (p: THREE.Vector3) => p.clone().applyQuaternion(UNYAW);

/** bx_B_Mat, the cutting mat on the bench top (8.2 × 3.9 m). */
export const MAT_TOP = 3.335;
/**
 * The blanks, as in the lead's render docs/design/blender/C-workbench-v1.png: cartridges lying face
 * up on a gridded mat, three either side of the turntable (where the picked one stands, spotlit),
 * their row bending gently toward you at its ends and each turned a little in toward the middle.
 */
export const BLANK_SCALE = 0.32;
/** Metres a blank lifts under the pointer. */
export const BLANK_LIFT = 0.08;
/** Across the bench (its own x) either side of the turntable, and forward (its own z): nearest the middle first. */
const ROW_XS = [1.6, 2.45, 3.3] as const;
const ROW_Z0 = 0.86;
const ROW_BEND = 0.12;
const ROW_TURN = 0.07;
/** Half a cartridge's thickness at scale 1 (cartridge.glb's body: ±0.17 m). */
const HALF_T = 0.17;

/** On a tall screen (a phone) the row can't fit across: three in a column either side of the turntable, back to front. */
const COL_X = 1.75;
const COL_ZS = [-0.75, 0.15, 1.05] as const;

export interface BlankPlace {
  x: number;
  z: number;
  turn: number;
}

/** Blank i's place in the bench's own frame: x, z and its turn (left to right, one per finish, saved.ts FINISHES). */
export const BLANK_PLACES: readonly BlankPlace[] = Array.from({ length: 6 }, (_, i) => {
  const side = i < 3 ? -1 : 1;
  const k = i < 3 ? 2 - i : i - 3;
  return { x: side * ROW_XS[k], z: ROW_Z0 + ROW_BEND * k, turn: -side * ROW_TURN * (k + 1) };
});
/** The tall screen's places: back to front down each column, the left column first. */
export const BLANK_PLACES_TALL: readonly BlankPlace[] = Array.from({ length: 6 }, (_, i) => {
  const side = i < 3 ? -1 : 1;
  return { x: side * COL_X, z: COL_ZS[i % 3], turn: side * ROW_TURN };
});
export const blankPlaces = (tall = false) => (tall ? BLANK_PLACES_TALL : BLANK_PLACES);
const centre = (p: BlankPlace) => benchPoint(p.x, MAT_TOP + HALF_T * BLANK_SCALE, p.z);
/** The six blanks' places on the mat (local to the anchor), on a wide screen and on a tall one. */
export const BLANKS: readonly THREE.Vector3[] = BLANK_PLACES.map(centre);
export const BLANKS_TALL: readonly THREE.Vector3[] = BLANK_PLACES_TALL.map(centre);
/** Lying on its back, label up, its top toward the back of the bench (turned a little, as its place says). */
const lying = (p: BlankPlace) => YAW.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, p.turn)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
const LYING_WIDE = BLANK_PLACES.map(lying);
const LYING_TALL = BLANK_PLACES_TALL.map(lying);

/** Blank i on the mat, lifted by `lift` (0–1) of BLANK_LIFT; `tall`: a phone's layout. */
export function blankPose(i: number, lift = 0, out: FlightPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1 }, tall = false): FlightPose {
  out.position.copy((tall ? BLANKS_TALL : BLANKS)[i]).addScaledVector(UP, lift * BLANK_LIFT);
  out.quaternion.copy((tall ? LYING_TALL : LYING_WIDE)[i]);
  out.scale = BLANK_SCALE;
  return out;
}

/** The turntable in the bench's own frame (x, z), and its ring's radius: the mat's spotlight and brackets centre there. */
export const TURNTABLE_LOCAL = (() => {
  const p = benchFrame(TURNTABLE);
  return { x: p.x, z: p.z, r: 0.965 };
})();

/** Seconds a picked blank takes from the mat to the turntable. */
export const PICK_S = 0.8;
const PICK_UP = 0.9;
const PICK_OVER = 0.75;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _home = new THREE.Quaternion();
const _from: FlightPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1 };

/**
 * A picked blank on its way to the turntable, local: up off the mat, standing up as it goes over,
 * and down onto the turntable where the bench's cartridge stands, growing to its size. One cubic Bezier,
 * eased in and out (it moves on screen). `tall`: from a phone's layout.
 */
export function pickPose(i: number, u: number, out: FlightPose, tall = false): FlightPose {
  const k = Math.min(1, Math.max(0, u));
  const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
  const home = benchCartridge();
  const from = blankPose(i, 0, _from, tall);
  const p0 = from.position;
  _a.copy(p0).addScaledVector(UP, PICK_UP);
  _b.copy(home.position).addScaledVector(UP, PICK_OVER);
  const a = 1 - e;
  out.position
    .copy(p0)
    .multiplyScalar(a * a * a)
    .addScaledVector(_a, 3 * a * a * e)
    .addScaledVector(_b, 3 * a * e * e)
    .addScaledVector(home.position, e * e * e);
  _home.setFromAxisAngle(UP, home.yaw);
  // It stands up a little ahead of the move, so it comes down upright.
  out.quaternion.slerpQuaternions(from.quaternion, _home, Math.min(1, e * 1.25));
  out.scale = BLANK_SCALE + (BENCH_SCALE - BLANK_SCALE) * e;
  return out;
}

/** The robot's hologram stands on the cartridge's top, this tall. */
export const HOLO_BASE = benchCartridge().position.add(new THREE.Vector3(0, HALF_H * BENCH_SCALE + 0.12, 0));
export const HOLO_H = 1.2;

export type ShotStage = "material" | "colour" | "robot" | "name" | "done";

/** Where on the screen a shot keeps its subject (fractions of the width and height, from the top left). */
interface Region {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
/** A phone: the editor is a sheet across the bottom (bench.css), 360 px of the 844; the journey rail on the right. */
const PHONE: Region = { x0: 0.04, x1: 0.88, y0: 0.1, y1: 0.55 };
/** A desktop, the subject beside the editor (bottom left, 440 px of the 1280). */
const BESIDE: Region = { x0: 0.37, x1: 0.86, y0: 0.12, y1: 0.94 };
/** A desktop, the row of blanks above the editor, across the screen. */
const ABOVE: Region = { x0: 0.03, x1: 0.97, y0: 0.12, y1: 0.5 };

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * A shot that holds a box (`half` metres each way round `focus`, seen along `dir`) inside a region of
 * the screen: it backs off until the box fits and turns aside so the box sits in the region's middle.
 */
function frame(focus: THREE.Vector3, dir: THREE.Vector3, halfW: number, halfH: number, region: Region, aspect: number, fov: number) {
  const ty = Math.tan(((fov / 2) * Math.PI) / 180);
  const tx = ty * aspect;
  const fx = region.x0 + region.x1 - 1;
  const fy = 1 - (region.y0 + region.y1);
  const d = Math.max(halfW / (tx * (region.x1 - region.x0)), halfH / (ty * (region.y1 - region.y0)));
  _dir.copy(dir).normalize();
  _right.crossVectors(_dir, UP).normalize();
  _up.crossVectors(_right, _dir);
  const eye = focus.clone().addScaledVector(_dir, -d);
  const target = focus.clone().addScaledVector(_right, -fx * tx * d).addScaledVector(_up, -fy * ty * d);
  return { position: eye.toArray() as [number, number, number], target: target.toArray() as [number, number, number], fov };
}

/** A shot from a fixed eye that turns aside so `focus` sits in the region's middle (frame, without backing off). */
function aim(eye: THREE.Vector3, focus: THREE.Vector3, region: Region, aspect: number, fov: number) {
  const ty = Math.tan(((fov / 2) * Math.PI) / 180);
  const tx = ty * aspect;
  const fx = region.x0 + region.x1 - 1;
  const fy = 1 - (region.y0 + region.y1);
  const d = focus.distanceTo(eye);
  _dir.copy(focus).sub(eye).normalize();
  _right.crossVectors(_dir, UP).normalize();
  _up.crossVectors(_right, _dir);
  const target = focus.clone().addScaledVector(_right, -fx * tx * d).addScaledVector(_up, -fy * ty * d);
  return { position: eye.toArray() as [number, number, number], target: target.toArray() as [number, number, number], fov };
}

const _cam = new THREE.PerspectiveCamera();
const _seen = new THREE.Vector3();

/**
 * aim(), widening the lens from `fov` (2° at a time, to 80° at most) until every point lands inside
 * the region, a little in from its edges.
 */
function fitFrom(eye: THREE.Vector3, focus: THREE.Vector3, points: readonly THREE.Vector3[], region: Region, aspect: number, fov: number) {
  let shot = aim(eye, focus, region, aspect, fov);
  for (let f = fov; f <= 80; f += 2) {
    shot = aim(eye, focus, region, aspect, f);
    _cam.fov = f;
    _cam.aspect = aspect;
    _cam.updateProjectionMatrix();
    _cam.position.set(...shot.position);
    _cam.lookAt(...shot.target);
    _cam.updateMatrixWorld(true);
    const inside = points.every((p) => {
      _seen.copy(p).project(_cam);
      const x = (_seen.x + 1) / 2;
      const y = (1 - _seen.y) / 2;
      return _seen.z < 1 && x > region.x0 + 0.03 && x < region.x1 - 0.03 && y > region.y0 + 0.03 && y < region.y1 - 0.03;
    });
    if (inside) break;
  }
  return shot;
}

/** The done shot's eye, local: up in the room's front corner beyond the bench, looking across it to the spiral. */
const DONE_EYE = new THREE.Vector3(-16, 10, 8).sub(ANCHOR);
/** A phone's is higher and further back, so the tall frame takes the bench and the spiral's top together. */
const DONE_EYE_PHONE = new THREE.Vector3(-17, 12, 10).sub(ANCHOR);

/** Blender's edit shot's direction: the colour, name and done shots look the same way. */
const EDIT_DIR = new THREE.Vector3(...EDIT_VIEW.target).sub(new THREE.Vector3(...EDIT_VIEW.position));
/** The material shot looks down on the row from the bench's front. */
const ROW_DIR = benchPoint(-0.08, -0.85, -1);

/** The spiral's empty places, local to the anchor: where a finished cartridge flies. */
const PLACES = SPARE.map((p) => new THREE.Vector3(...p.position).sub(ANCHOR));

/** Each stage's camera, local to the anchor, for a screen of this aspect (width / height). */
export function shotFor(stage: ShotStage, aspect: number) {
  const phone = aspect < 1;
  const fov = phone ? 52 : EDIT_VIEW.fov;
  const home = benchCartridge().position;
  if (stage === "material") {
    // The row either side of the turntable, and the turntable between (a phone: the two columns).
    if (phone) return frame(benchPoint(0, MAT_TOP + 0.35, 0.3), ROW_DIR, COL_X + 0.8, 1.4, PHONE, aspect, fov);
    return frame(benchPoint(0, MAT_TOP + 0.35, ROW_Z0 + 0.05), ROW_DIR, ROW_XS[2] + 0.55, 1.05, ABOVE, aspect, fov);
  }
  if (stage === "robot") {
    const top = HOLO_BASE.y + HOLO_H;
    const bottom = home.y - HALF_H * BENCH_SCALE;
    const focus = home.clone().setY((top + bottom) / 2);
    return frame(focus, EDIT_DIR, 0.95, (top - bottom) / 2 + 0.12, phone ? PHONE : BESIDE, aspect, fov);
  }
  if (stage === "done") {
    // From up in the room's front, over the bench, looking to the spiral: the flight reads from end to
    // end, and the camera stays inside the room (the bench backs onto the robot shelves).
    const far = PLACES.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(PLACES.length);
    const focus = home.clone().lerp(far, 0.55);
    return fitFrom(phone ? DONE_EYE_PHONE : DONE_EYE, focus, [home, ...PLACES], phone ? PHONE : BESIDE, aspect, phone ? 52 : 40);
  }
  // The name stage comes in a little closer on the label; colour holds the whole cartridge and some room.
  const close = stage === "name" ? 0.9 : 1;
  return frame(home, EDIT_DIR, 1.25 * close, (HALF_H * BENCH_SCALE + 0.4) * close, phone ? PHONE : BESIDE, aspect, fov);
}
