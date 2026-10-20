// The live twin's state, as a reducer over the relay's twin socket (/ws/teleop?role=twin, read-only): pure, so
// useLiveTwin is a thin WebSocket wrapper around it.
import { apiUrl } from "../api/client";
import type { TwinContact } from "./contact";
import { namedJoints, type TwinFrame, type TwinMessage, type TwinScene } from "./messages";
import type { TwinPose, TwinState } from "./types";

/** connecting: never reached the backend yet. offline: the socket closed (retrying). no_sim: the backend is up but
 *  the sink isn't. waiting: the sink is up, no pose yet. live: posing from the sim. */
export type LiveStatus = "connecting" | "offline" | "no_sim" | "waiting" | "live";

export type LiveState = {
  socket: "connecting" | "open" | "closed";
  simConnected: boolean | null;
  scene: TwinScene | null;
  frame: TwinFrame | null;
};

export type LiveEvent = { kind: "open" } | { kind: "close" } | { kind: "message"; msg: TwinMessage };

export const LIVE_START: LiveState = { socket: "connecting", simConnected: null, scene: null, frame: null };

/** The sink's twin socket, from the API base (as teleopSocketUrl in ../pm/api.ts builds the browser's). */
export function twinSocketUrl(base: string = apiUrl("")): string {
  return `${base.replace(/\/$/, "").replace(/^http/, "ws")}/ws/teleop?role=twin`;
}

export function liveReducer(state: LiveState, event: LiveEvent): LiveState {
  if (event.kind === "open") return { ...state, socket: "open" };
  if (event.kind === "close") return { ...LIVE_START, socket: "closed" };
  const { msg } = event;
  if (msg.kind === "status")
    return msg.simConnected ? { ...state, simConnected: true } : { ...state, simConnected: false, scene: null, frame: null };
  if (msg.kind === "scene") return { ...state, simConnected: true, scene: msg.scene, frame: null };
  return state.scene ? { ...state, simConnected: true, frame: msg.frame } : state; // a frame needs its scene's names
}

export function liveStatus(s: LiveState): LiveStatus {
  if (s.socket !== "open") return s.socket === "closed" ? "offline" : "connecting";
  if (s.simConnected === false) return "no_sim";
  return s.scene && s.frame ? "live" : "waiting";
}

/** contact: the arm's push now (./contact.ts); floor: the soft floor is holding the target up. Both null without a
 *  frame, or from a sim that doesn't send them. */
export type LiveTwin = TwinState & { status: LiveStatus; base: TwinPose | null; robot: string | null; contact: TwinContact | null; floor: boolean | null };

export function liveTwin(s: LiveState): LiveTwin {
  const { scene, frame } = s;
  return {
    status: liveStatus(s),
    robot: scene?.robot ?? null,
    base: scene?.base ?? null,
    bin: scene?.bin ?? null,
    joints: scene && frame ? namedJoints(scene.jointNames, frame.q) : null,
    gripper: frame?.gripper ?? null,
    cube: frame?.cube ?? null,
    contact: frame?.contact ?? null,
    floor: frame?.floor ?? null,
  };
}
