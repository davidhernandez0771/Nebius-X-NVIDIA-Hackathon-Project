// The relay's robot-twin messages (src/app/routers/teleop.py, /ws/teleop?role=twin):
//   {"type": "status", "sim_connected": bool}
//   {"type": "sim_twin_scene", "robot", "joint_names", "base": pose7, "bin": pose7}   once per sim connection
//   {"type": "sim_twin", "q", "gripper": 0 | 1, "cube": pose7}                         at most ~30 a second
// where pose7 is [x, y, z, qw, qx, qy, qz] (sim_worker/teleop_session.py twin_scene() and twin()).

import type { TwinPose } from "./types";

export type TwinScene = { robot: string; jointNames: string[]; base: TwinPose; bin: TwinPose };
export type TwinFrame = { q: number[]; gripper: 0 | 1; cube: TwinPose };

export type TwinMessage =
  | { kind: "status"; simConnected: boolean }
  | { kind: "scene"; scene: TwinScene }
  | { kind: "frame"; frame: TwinFrame };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function pose7(v: unknown): TwinPose | null {
  if (!Array.isArray(v) || v.length !== 7 || !v.every(isNum)) return null;
  return { pos: [v[0], v[1], v[2]], quat: [v[3], v[4], v[5], v[6]] };
}

export function parseTwinMessage(data: unknown): TwinMessage | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(String(data)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  if (msg.type === "status" && typeof msg.sim_connected === "boolean") return { kind: "status", simConnected: msg.sim_connected };
  if (msg.type === "sim_twin_scene") {
    const base = pose7(msg.base);
    const bin = pose7(msg.bin);
    const names = msg.joint_names;
    if (typeof msg.robot !== "string" || !base || !bin || !Array.isArray(names) || !names.every((n) => typeof n === "string")) return null;
    return { kind: "scene", scene: { robot: msg.robot, jointNames: names as string[], base, bin } };
  }
  if (msg.type === "sim_twin") {
    const cube = pose7(msg.cube);
    const q = msg.q;
    if (!cube || !Array.isArray(q) || !q.every(isNum) || (msg.gripper !== 0 && msg.gripper !== 1)) return null;
    return { kind: "frame", frame: { q: q as number[], gripper: msg.gripper, cube } };
  }
  return null;
}

/** joint name -> position; null when the counts disagree (a frame from another scene). */
export function namedJoints(names: string[], q: number[]): Record<string, number> | null {
  if (names.length !== q.length) return null;
  return Object.fromEntries(names.map((n, i) => [n, q[i]]));
}
