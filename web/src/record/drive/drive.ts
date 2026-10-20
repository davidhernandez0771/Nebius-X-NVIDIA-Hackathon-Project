// Keyboard and mouse driving for /record: record clean demos without the camera. Everything is in the robot's own
// frame, as if standing behind it: x forward (away from the base), y to the robot's left, z up, meters.
//
// Keys: W/S (or arrows up/down) forward/back, A/D (arrows left/right) the robot's left/right, R/F up/down. They set a
// velocity that ramps to the speed over RAMP_S and back to 0 after release, so the target moves smoothly, never in
// steps. Shift is the fine mode (FINE of the speed). The mouse (Pointer Lock) moves a goal by its deltas (mouse up =
// forward, right = the robot's right, wheel = up/down), and the target follows the goal with a critically damped
// pursuit, bounded in speed and acceleration, so a quick flick is a ramp too. Both are clamped to the workspace (the
// sim's Calibration ranges), and a component that hits an edge stops there.
//
// The target goes out as the camera path's HandPoseMsg: tracking_ok true, `control` the target as fractions of the
// workspace (exactly what to_ee_target maps back, tests/test_drive_mapping.py), `grip` the gripper (Space or a
// click toggles it). The sim needs no new message type; it only smooths keyboard and mouse targets once more
// (sim_worker.teleop_session, set_input), because a 30 Hz stream sampled at 50 Hz is a staircase.

import { WORKSPACE } from "../../site/record-hud/hudModel";
import type { HandPoseMsg } from "../teleop/handPoseMessage";

export type Vec3 = [number, number, number];
export type InputMode = "camera" | "keyboard" | "mouse";
export const INPUT_MODES: readonly InputMode[] = ["keyboard", "mouse", "camera"];

/** sim_worker/scripted.py HOME_TCP: above the table, between the cube and the base. Update together. */
export const HOME: Vec3 = [0.45, 0, 0.35];
export const TICK_S = 1 / 30; // the page sends at the camera path's ~30 Hz (TeleopClient.MIN_INTERVAL_MS)
export const RAMP_S = 0.25; // from still to full speed (and back)
export const FINE = 0.3; // Shift: this fraction of the speed (and of mouse motion)
export const SPEED_MIN = 0.03; // m/s
export const SPEED_MAX = 0.3;
export const MOUSE_SENS_MIN = 0.0001; // m per pixel of mouse motion
export const MOUSE_SENS_MAX = 0.002;
export const WHEEL_M = 0.01; // up/down per wheel notch (deltaY 100)
const MOUSE_TAU_S = 0.08; // the pursuit's time constant
const MOUSE_V_MAX = 0.4; // m/s
const MOUSE_A_MAX = 2; // m/s^2

export interface DriveSettings {
  input: InputMode;
  speed: number; // keyboard, m/s
  mouseSens: number; // m per pixel
  softFloor: boolean; // every input: the sim holds the target above the bin rim and table (demo_pipeline/soft_floor.py)
}

export const DEFAULT_DRIVE: DriveSettings = { input: "keyboard", speed: 0.1, mouseSens: 0.0004, softFloor: true };
export const DRIVE_STORAGE_KEY = "pm.teleop.drive";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const RANGES = [WORKSPACE.x, WORKSPACE.y, WORKSPACE.z] as const;

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, +1],
  ArrowUp: [0, +1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [1, +1],
  ArrowLeft: [1, +1],
  KeyD: [1, -1],
  ArrowRight: [1, -1],
  KeyR: [2, +1],
  KeyF: [2, -1],
};

/** The KeyboardEvent.code values that move the arm. */
export const MOVE_CODES = Object.keys(KEYS);

/** The held keys (KeyboardEvent.code) -> a direction in the robot's frame; a diagonal has length 1. */
export function keyAxes(down: ReadonlySet<string>): Vec3 {
  const a: Vec3 = [0, 0, 0];
  const seen = new Set<string>();
  for (const code of down) {
    const k = KEYS[code];
    if (!k) continue;
    const id = `${k[0]}${k[1]}`; // W and ArrowUp together are one key's worth
    if (seen.has(id)) continue;
    seen.add(id);
    a[k[0]] += k[1];
  }
  const n = Math.hypot(...a);
  return n > 1 ? (a.map((v) => v / n) as Vec3) : a;
}

/** A mouse move (Pointer Lock movementX/Y, px) -> a goal displacement in the robot's frame. */
export function mouseDelta(dx: number, dy: number, sens: number, fine: boolean): Vec3 {
  const s = sens * (fine ? FINE : 1);
  return [-dy * s + 0, -dx * s + 0, 0];
}

/** A wheel event's deltaY (100 per notch, down positive) -> a goal displacement: wheel up = up. */
export function wheelDelta(deltaY: number, fine: boolean): Vec3 {
  return [0, 0, (-deltaY / 100) * WHEEL_M * (fine ? FINE : 1) + 0];
}

export class Drive {
  pos: Vec3 = [...HOME];
  vel: Vec3 = [0, 0, 0]; // the keys' velocity
  gripper: 0 | 1 = 0;
  private goal: Vec3 = [...HOME]; // where the mouse wants the target
  private mouseVel: Vec3 = [0, 0, 0];

  /** One tick: the keys' ramped velocity, the mouse pursuit, the clamp. Returns the new target. */
  step(dt: number, axes: Vec3, { speed, fine }: { speed: number; fine: boolean }): Vec3 {
    const top = speed * (fine ? FINE : 1);
    const accel = speed / RAMP_S;
    const w = 1 / MOUSE_TAU_S;
    // The keys' velocity: toward axes * top, braking ahead of an edge (at most sqrt(2 a d) toward it, so it stops
    // there at the same deceleration), changing by at most accel * dt as a vector.
    const want = axes.map((a, k) => {
      const v = a * top;
      const [lo, hi] = RANGES[k];
      const room = v > 0 ? hi - this.pos[k] : this.pos[k] - lo;
      return Math.sign(v) * Math.min(Math.abs(v), Math.sqrt(2 * accel * Math.max(0, room)));
    });
    const change = want.map((v, k) => v - this.vel[k]);
    const size = Math.hypot(...change);
    const scale = size > accel * dt ? (accel * dt) / size : 1;
    for (let k = 0; k < 3; k++) {
      this.vel[k] += change[k] * scale;
      if (Math.abs(this.vel[k]) < 1e-12) this.vel[k] = 0;
      const acc = clamp(w * w * (this.goal[k] - this.pos[k]) - 2 * w * this.mouseVel[k], -MOUSE_A_MAX, MOUSE_A_MAX);
      this.mouseVel[k] = clamp(this.mouseVel[k] + acc * dt, -MOUSE_V_MAX, MOUSE_V_MAX);
      this.pos[k] += (this.vel[k] + this.mouseVel[k]) * dt;
      this.goal[k] += this.vel[k] * dt;
      const [lo, hi] = RANGES[k];
      if (this.pos[k] <= lo || this.pos[k] >= hi) {
        this.pos[k] = clamp(this.pos[k], lo, hi);
        // stop pushing past the edge; a velocity pointing back inside is kept
        if (Math.sign(this.vel[k]) === Math.sign(this.pos[k] - (lo + hi) / 2)) this.vel[k] = 0;
        if (Math.sign(this.mouseVel[k]) === Math.sign(this.pos[k] - (lo + hi) / 2)) this.mouseVel[k] = 0;
      }
      this.goal[k] = clamp(this.goal[k], lo, hi);
    }
    return [...this.pos];
  }

  /** Move the goal (a mouse or wheel delta); the target follows it on the next ticks. */
  nudge(d: Vec3) {
    for (let k = 0; k < 3; k++) this.goal[k] = clamp(this.goal[k] + d[k], RANGES[k][0], RANGES[k][1]);
  }

  toggleGripper() {
    this.gripper = this.gripper ? 0 : 1;
  }

  /** Home, still, gripper open (Reset scene puts the robot back at its start). */
  reset() {
    this.pos = [...HOME];
    this.goal = [...HOME];
    this.vel = [0, 0, 0];
    this.mouseVel = [0, 0, 0];
    this.gripper = 0;
  }
}

/** The target as HandPoseMsg.control: [u, v, depth] such that to_ee_target maps it back (u is mirrored there). */
export function controlOf([x, y, z]: Vec3): [number, number, number] {
  const f = (v: number, [lo, hi]: readonly [number, number]) => clamp((v - lo) / (hi - lo), 0, 1);
  return [f(y, WORKSPACE.y), 1 - f(z, WORKSPACE.z), f(x, WORKSPACE.x)];
}

/** The camera path's message for a target: the backend validates it as HandPoseMsg, the sim maps `control`. */
export function driveMessage(target: Vec3, grip: 0 | 1, tMs: number): HandPoseMsg {
  return {
    t_ms: tMs,
    tracking_ok: true,
    wrist_uv: [0.5, 0.5],
    palm_width: 0.1,
    pinch_ratio: grip ? 0.2 : 0.8, // what a pinch would read; the sim follows grip
    yaw_rad: 0,
    frame_w: 640,
    frame_h: 480,
    control: controlOf(target),
    grip,
  };
}

export function sanitizeDriveSettings(raw: unknown): DriveSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_DRIVE;
  return {
    input: INPUT_MODES.includes(o.input as InputMode) ? (o.input as InputMode) : d.input,
    speed: finite(o.speed) ? clamp(o.speed, SPEED_MIN, SPEED_MAX) : d.speed,
    mouseSens: finite(o.mouseSens) ? clamp(o.mouseSens, MOUSE_SENS_MIN, MOUSE_SENS_MAX) : d.mouseSens,
    softFloor: typeof o.softFloor === "boolean" ? o.softFloor : d.softFloor,
  };
}

export function loadDriveSettings(store?: Pick<Storage, "getItem">): DriveSettings {
  try {
    const raw = (store ?? localStorage).getItem(DRIVE_STORAGE_KEY);
    return raw ? sanitizeDriveSettings(JSON.parse(raw)) : DEFAULT_DRIVE;
  } catch {
    return DEFAULT_DRIVE;
  }
}

export function saveDriveSettings(s: DriveSettings, store?: Pick<Storage, "setItem">): void {
  try {
    (store ?? localStorage).setItem(DRIVE_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage blocked: the settings just won't persist
  }
}
