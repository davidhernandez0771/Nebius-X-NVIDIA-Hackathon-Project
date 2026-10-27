// The plug-in, carried by the arm (Arm.tsx follows this path with its fingertips on the cartridge's
// top edge): the arm reaches the cartridge in its slot and closes on it, pulls it out past the spiral,
// the spiral rises out of view (lift.ts), the arm carries it round to above the port at the machine's
// left end turning edge-on, lowers it in, the slot lights, the arm lets go, the spiral comes back
// down, and the projector comes up (beam, wireframe arm, the Record screen). One timeline u 0–1
// drives all of it; pure, so every phase is tested. World coordinates.
import * as THREE from "three";
import { MACHINE_PIVOT, slotAt } from "./layout";
import { liftOfPlug } from "./lift";
import { ARM, GRIP_DEPTH, HANG, SHOULDER_MAX } from "./armIk";

export const PLUG_S = 3.6;

/**
 * Phase boundaries on u: the arm reaching the slot, the pull out of it, the spiral rising, the flight,
 * the insert, the click (the arm lets go), the projector; the spiral comes back down over `down`.
 */
export const PHASE = { reach: [0, 0.1], pull: [0.1, 0.2], lift: [0.2, 0.36], fly: [0.36, 0.62], insert: [0.62, 0.74], click: [0.74, 0.8], project: [0.8, 1], down: [0.8, 0.95] } as const;

/** The spiral's lift (lift.ts level) at u. */
export const liftAt = (u: number, held = false) => liftOfPlug(u, PHASE.lift, PHASE.down, held);

/** The dock's slot (machine_v2.glb, machineV2.ts), in the machine's frame (the 28° turn baked in): its centre and its top. */
export const PORT_LOCAL = new THREE.Vector3(-3.265, 0, 1.741);
export const SLOT_TOP_LOCAL = 4.95;
const HALF_H = 1.25;

/**
 * The cartridge bay on the dock (built in code, stations/machine/Scene.tsx): machine_v2's own slot is a
 * shallow plate 0.36 × 1.44 m, and a cartridge is 2.3 m wide, 0.34 m thick and 2.5 m tall, so it could
 * only sit on top of it. The bay's opening is the cartridge's footprint and a little clearance; it
 * stands on the dock's top, and a seated cartridge sinks its whole height into it (42% of the
 * cartridge, the edge connector out of sight), resting on the dock. Half sizes, in the machine's frame
 * (long: along the slot, the machine's local z; short: across it), metres.
 */
export const BAY = { halfLong: 1.15 + 0.04, halfShort: 0.17 + 0.04, wall: 0.09, height: 1.05 } as const;
/** How much of the 2.5 m cartridge sinks into the bay. */
const DEPTH = BAY.height;

const PIVOT = new THREE.Vector3(...MACHINE_PIVOT.position);
const PORT = PIVOT.clone().add(PORT_LOCAL);
/** The plugged-in cartridge's centre: its bottom on the dock's top, inside the bay. */
export const PLUGGED = new THREE.Vector3(PORT.x, PIVOT.y + SLOT_TOP_LOCAL + HALF_H, PORT.z);
const ABOVE = PLUGGED.clone().setY(PLUGGED.y + DEPTH + 0.45);
/** The middle of the bay's opening, on its top (where a drop target's light stands). */
export const PORT_TOP: Readonly<THREE.Vector3> = PLUGGED.clone().setY(PIVOT.y + SLOT_TOP_LOCAL + BAY.height);
/** The dock's top under the bay, at the port (world): the bay stands here. */
export const DOCK_TOP: Readonly<THREE.Vector3> = PLUGGED.clone().setY(PIVOT.y + SLOT_TOP_LOCAL);
/** Over the port, before it drops in: where a cartridge dragged onto the machine waits (held). */
export const ABOVE_PORT: Readonly<THREE.Vector3> = ABOVE;
/**
 * Plugged in: upright, its width along the slot (the machine's local z), its face toward the
 * machine's -x, the spiral's side: a quarter turn back from the machine's own turn.
 */
export const PLUGGED_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), MACHINE_PIVOT.yaw - Math.PI / 2);

/**
 * Out of the slot it comes INTO the spiral's hollow core, beside the arm's mast: up a little, in along
 * its bearing to CORE_R, and down inside the core if the arm couldn't hang straight down to it there.
 * In the core, the arm and the cartridge are clear of the spiral's ring (its cartridges and band), so
 * the spiral can rise past them, and come back down round them, without touching (lift.ts).
 */
export const PULL_UP = 0.35;
/** Where a pulled cartridge's centre waits from the axis: its corners inside the band's inner edge (1.68 m), its back clear of the mast. */
export const CORE_R = 0.8;
/** The highest it waits in the core: the arm hangs straight down to it from the top of its mast (armIk.ts HANG). */
export const CORE_TOP_Y = SHOULDER_MAX - HANG * 0.99 - ARM.hand - (HALF_H - GRIP_DEPTH);
/** The port's angle and distance around the spiral's axis. */
const PORT_A = Math.atan2(ABOVE.x, ABOVE.z);
const PORT_R = Math.hypot(ABOVE.x, ABOVE.z);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const span = (u: number, [a, b]: readonly [number, number]) => clamp01((u - a) / (b - a));
const smooth = (x: number) => x * x * (3 - 2 * x);
const easeIn = (x: number) => x * x * x;

export interface CartridgePose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** A pull out of a slot, in cylindrical terms: from the slot's bearing and radius to the pulled ones. */
export interface Pull {
  a0: number;
  a1: number;
  r0: number;
  r1: number;
  y0: number;
  y1: number;
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const _q = new THREE.Quaternion();

/** Where a cartridge at `p` waits once it is out of its slot: in the core, on its own bearing (see CORE_R). */
export function pullOf(p: THREE.Vector3): Pull {
  const r0 = Math.hypot(p.x, p.z);
  const a0 = Math.atan2(p.x, p.z);
  return { a0, a1: a0, r0, r1: CORE_R, y0: p.y, y1: Math.min(p.y + PULL_UP, CORE_TOP_Y) };
}

const Y = new THREE.Vector3(0, 1, 0);
const _core = new THREE.Quaternion();

/**
 * How it is turned along a pull: from its slot's turn to facing straight out from the axis, so its
 * width lies across the core (its corners inside it) however its slot stood.
 */
export function pullQuat(pull: Pull, slotQ: THREE.Quaternion, a: number, out: THREE.Quaternion): THREE.Quaternion {
  _core.setFromAxisAngle(Y, pull.a1);
  return out.slerpQuaternions(slotQ, _core, smooth(clamp01(a / 0.6)));
}

/** Along a pull at a (0 in the slot, 1 in the core): up a little, in toward the axis, then down inside the core if it must. */
export function pullAt(pull: Pull, a: number, out: THREE.Vector3): THREE.Vector3 {
  const kr = smooth(clamp01(a / 0.6));
  const r = pull.r0 + (pull.r1 - pull.r0) * kr;
  const ang = pull.a0 + wrapPi(pull.a1 - pull.a0) * kr;
  const up = pull.y0 + PULL_UP * smooth(clamp01(a / 0.35));
  const y = up + (pull.y1 - (pull.y0 + PULL_UP)) * smooth(clamp01((a - 0.55) / 0.45));
  return out.set(r * Math.sin(ang), y, r * Math.cos(ang));
}

function slotPose(slot: number) {
  const s = slotAt(slot);
  const q = new THREE.Quaternion(...s.quaternion);
  const p = new THREE.Vector3(...s.position);
  const pull = pullOf(p);
  const pulled = pullAt(pull, 1, new THREE.Vector3());
  return { p, q, pull, pulled };
}

/**
 * Where the cartridge from `slot` is at u (and how it is turned). `held`: it was dragged onto the
 * machine and let go over the port, so it skips the pull and the flight and waits there, edge-on,
 * until the insert, on the same beat as a click's (the camera's path and the slot light keep theirs).
 */
export function cartridgePose(slot: number, u: number, out: CartridgePose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, held = false): CartridgePose {
  if (held && u <= PHASE.fly[1]) {
    out.position.copy(ABOVE);
    out.quaternion.copy(PLUGGED_Q);
    return out;
  }
  const { p, q: slotQ, pull, pulled } = slotPose(slot);
  const q = pullQuat(pull, slotQ, 1, _q);
  const a = span(u, PHASE.pull);
  const f = span(u, PHASE.fly);
  const d = span(u, PHASE.insert);
  if (u <= PHASE.lift[1]) {
    // In its slot while the arm reaches it, then into the spiral's core, where it waits while the
    // spiral rises away.
    if (a <= 0) out.position.copy(p);
    else pullAt(pull, a, out.position);
    pullQuat(pull, slotQ, a, out.quaternion);
  } else if (u <= PHASE.fly[1]) {
    // The spiral is up out of the way: out of the core and round the axis the short way to the port,
    // within the arm's reach; it turns edge-on once it is well clear of the mast. Going up, the height
    // leads (clear of the desk and the machine before it gets there); coming down from high up it follows.
    const a0 = Math.atan2(pulled.x, pulled.z);
    const r0 = Math.hypot(pulled.x, pulled.z);
    let turn = PORT_A - a0;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    const ang = a0 + turn * smooth(f);
    const down = pulled.y > ABOVE.y + 1;
    const lead = smooth(clamp01(f / 0.4));
    const follow = smooth(clamp01((f - 0.3) / 0.7));
    const rr = r0 + (PORT_R - r0) * smooth(clamp01((f - 0.05) / 0.75));
    const y = pulled.y + (ABOVE.y - pulled.y) * (down ? follow : lead);
    out.position.set(rr * Math.sin(ang), y, rr * Math.cos(ang));
    out.quaternion.slerpQuaternions(q, PLUGGED_Q, smooth(clamp01((f - 0.4) / 0.5)));
  } else {
    out.position.lerpVectors(ABOVE, PLUGGED, easeIn(d));
    out.quaternion.copy(PLUGGED_Q);
  }
  return out;
}

/** The slot's light: off, a flash as the cartridge seats, then steady. */
export function slotGlow(u: number): number {
  if (u < PHASE.insert[1]) return 0;
  const c = span(u, PHASE.click);
  return c < 1 ? 1.6 - 0.6 * c : 1;
}

/** The projector: 0 until the click, then up over the last phase. */
export function projection(u: number): number {
  return smooth(span(u, PHASE.project));
}

/**
 * The machine's dwell drives u when nobody clicked: the cartridge is in by the "Plug in" stop
 * (dwell t 0.5) and the projector is up just before the "Projection" stop.
 */
export function scrollU(t: number): number {
  if (t <= 0.5) return PHASE.click[1] * smooth(clamp01((t - 0.04) / 0.46));
  return PHASE.click[1] + (1 - PHASE.click[1]) * clamp01((t - 0.5) / 0.35);
}

/** u for a click at `startedAt` (seconds), now; with reduced motion, straight to plugged in. */
export function timeU(startedAt: number, now: number, reduced: boolean): number {
  return reduced ? 1 : clamp01((now - startedAt) / PLUG_S);
}
