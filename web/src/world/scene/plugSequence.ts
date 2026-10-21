// The plug-in, as in docs/design/blender/W-anim-insert-plug-v1-0600-0960.mp4: the cartridge tilts out
// of its spiral slot, flies over to the machine turning edge-on, drops into the port at the machine's
// left end, the slot lights, and the projector comes up (beam, wireframe arm, the Record screen).
// One timeline u 0–1 drives all of it; pure, so every phase is tested. World coordinates.
import * as THREE from "three";
import { MACHINE_PIVOT, slotAt } from "./layout";

export const PLUG_S = 3.6;

/** Phase boundaries on u. */
export const PHASE = { pull: [0, 0.14], fly: [0.14, 0.58], insert: [0.58, 0.74], click: [0.74, 0.8], project: [0.8, 1] } as const;

/** The dock's slot (machine_v2.glb, machineV2.ts), in the machine's frame (the 28° turn baked in): its centre and its top. */
export const PORT_LOCAL = new THREE.Vector3(-3.265, 0, 1.741);
export const SLOT_TOP_LOCAL = 4.95;
/** How much of the 2.5 m cartridge sinks into the port. */
const DEPTH = 0.83;
const HALF_H = 1.25;

const PIVOT = new THREE.Vector3(...MACHINE_PIVOT.position);
const PORT = PIVOT.clone().add(PORT_LOCAL);
/** The plugged-in cartridge's centre. */
export const PLUGGED = new THREE.Vector3(PORT.x, PIVOT.y + SLOT_TOP_LOCAL - DEPTH + HALF_H, PORT.z);
const ABOVE = PLUGGED.clone().setY(PLUGGED.y + DEPTH + 1.5);
/** The middle of the port's opening, on the machine's top (where a drop target's light stands). */
export const PORT_TOP: Readonly<THREE.Vector3> = PLUGGED.clone().setY(PIVOT.y + SLOT_TOP_LOCAL);
/** Over the port, before it drops in: where a cartridge dragged onto the machine waits (held). */
export const ABOVE_PORT: Readonly<THREE.Vector3> = ABOVE;
/**
 * Plugged in: upright, its width along the slot (the machine's local z), its face toward the
 * machine's -x, the spiral's side: a quarter turn back from the machine's own turn.
 */
export const PLUGGED_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), MACHINE_PIVOT.yaw - Math.PI / 2);

const PULL_OUT = 0.55;
const PULL_UP = 0.4;
/** How far a flight from the far side swings out past the spiral, at most. */
const SWING = 2.2;
/** How much further out a flight coming down from the top of the spiral stays. */
const DOWN_OUT = 1.6;
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

function slotPose(slot: number) {
  const s = slotAt(slot);
  const q = new THREE.Quaternion(...s.quaternion);
  const p = new THREE.Vector3(...s.position);
  const out = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const pulled = p.clone().addScaledVector(out, PULL_OUT).setY(p.y + PULL_UP);
  // Tilted out of the slot as it comes free, top first, like the render's first frames.
  const tilted = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.18));
  return { p, q, pulled, tilted };
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
  const { p, q, pulled, tilted } = slotPose(slot);
  const a = span(u, PHASE.pull);
  const f = span(u, PHASE.fly);
  const d = span(u, PHASE.insert);
  if (u <= PHASE.pull[1]) {
    const k = smooth(a);
    out.position.lerpVectors(p, pulled, k);
    out.quaternion.slerpQuaternions(q, tilted, k);
  } else if (u <= PHASE.fly[1]) {
    // Around the spiral, not through it: the angle about the axis turns the short way to the port.
    // Going up, the height leads (clear of the desk before it gets there) and the distance from the
    // axis follows; coming down from high up it is the other way round, out from the spiral first.
    // It swings wider the further it has to go round.
    const a0 = Math.atan2(pulled.x, pulled.z);
    const r0 = Math.hypot(pulled.x, pulled.z);
    let turn = PORT_A - a0;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    const ang = a0 + turn * smooth(f);
    const swing = SWING * Math.min(1, Math.abs(turn) / (Math.PI * 0.6));
    const down = pulled.y > ABOVE.y + 1;
    const lead = smooth(clamp01(f / 0.45));
    const follow = smooth(clamp01((f - 0.35) / 0.65));
    const r = r0 + (PORT_R - r0) * (down ? lead : follow) + (swing + (down ? DOWN_OUT : 0)) * Math.sin(Math.PI * f);
    const y = pulled.y + (ABOVE.y - pulled.y) * (down ? follow : lead);
    out.position.set(r * Math.sin(ang), y, r * Math.cos(ang));
    // It turns edge-on only once it is up and clear (the turn swings its width out).
    out.quaternion.slerpQuaternions(tilted, PLUGGED_Q, smooth(clamp01((f - 0.3) / 0.6)));
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
