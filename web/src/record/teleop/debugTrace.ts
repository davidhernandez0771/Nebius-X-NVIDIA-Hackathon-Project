// Record debug trace: a few seconds of everything the hand control sees and sends, frame by
// frame, as a JSON file the user downloads and hands to the lead. Ported from pm/t4-diagnoser's
// 5ceab31 for hand v3: the pinch, the V sign score, both reach signals and the break-through cue.

import type { HandFrame, TrackedHand } from "../../hand/contracts";
import type { TeleopControlSettings } from "./controlRegion";
import type { HandPoseMsg } from "./handPoseMessage";

export const TRACE_SECONDS = 10;
export const TRACE_VERSION = 3; // 1: pm/t4-diagnoser's sprint 8 trace; 2: hand v3's 3D pinch {value, source}

/** The page's per-frame values beyond the message. */
export interface TraceSignals {
  pinch: number | null; // the 2D pinch gap (pinch.ts)
  gripper: 0 | 1;
  victory: number | null;
  size3d: number | null; // the 3D reach signal
  reachSize: number | null; // the one reach used (palm width, or the 3D size with 3D reach on)
  reach3d: boolean;
  breakthrough: number;
  breakthroughDir: 1 | -1;
}

export interface TraceFrame {
  t: number; // HandFrame.timestamp, ms
  frame: [number, number]; // width, height in px
  hands: number;
  handedness: string | null;
  landmarks: number[][] | null; // 21 x [x, y, z], raw normalized image coordinates
  world: number[][] | null; // 21 x [x, y, z], meters (worldLandmarks)
  pinch: number | null; // the 2D pinch gap (pinch.ts)
  victory: number | null;
  reach: { palmWidth: number | null; size3d: number | null; used: number | null; reach3d: boolean };
  breakthrough: { count: number; dir: 1 | -1 };
  sent: Pick<HandPoseMsg, "tracking_ok" | "wrist_uv" | "palm_width" | "pinch_ratio" | "control">;
  gripper: 0 | 1;
}

export interface TraceFile {
  kind: "pm-hand-trace";
  version: number;
  startedAt: string;
  durationMs: number;
  frameWidth: number | null;
  frameHeight: number | null;
  settings: TeleopControlSettings;
  frames: TraceFrame[];
}

const r5 = (v: number): number => Math.round(v * 1e5) / 1e5;
const r5n = (v: number | null | undefined): number | null => (typeof v === "number" ? r5(v) : null);
const xyz = (p: { x: number; y: number; z: number }) => [r5(p.x), r5(p.y), r5(p.z)];

export function traceFrame(frame: HandFrame, hand: TrackedHand | null, msg: HandPoseMsg, s: TraceSignals): TraceFrame {
  return {
    t: frame.timestamp,
    frame: [frame.frameWidth, frame.frameHeight],
    hands: frame.hands.length,
    handedness: hand?.handedness ?? null,
    landmarks: hand ? hand.landmarks.map(xyz) : null,
    world: hand?.worldLandmarks ? hand.worldLandmarks.map(xyz) : null,
    pinch: r5n(s.pinch),
    victory: r5n(s.victory),
    reach: { palmWidth: msg.tracking_ok ? r5(msg.palm_width) : null, size3d: r5n(s.size3d), used: r5n(s.reachSize), reach3d: s.reach3d },
    breakthrough: { count: s.breakthrough, dir: s.breakthroughDir },
    sent: {
      tracking_ok: msg.tracking_ok,
      wrist_uv: [r5(msg.wrist_uv[0]), r5(msg.wrist_uv[1])],
      palm_width: r5(msg.palm_width),
      pinch_ratio: r5(msg.pinch_ratio),
      ...(msg.control ? { control: msg.control.map(r5) as [number, number, number] } : {}),
    },
    gripper: s.gripper,
  };
}

export interface TraceState {
  progress: number; // 0..1
  done: boolean;
  frames: number;
}

/** Collects `durationMs` of trace frames, timed from the first one. */
export class DebugTrace {
  private readonly items: TraceFrame[] = [];
  private start: number | null = null;
  private done = false;

  constructor(readonly durationMs: number = TRACE_SECONDS * 1000) {}

  push(f: TraceFrame): TraceState {
    if (!this.done) {
      if (this.start === null) this.start = f.t;
      this.items.push(f);
      if (f.t - this.start >= this.durationMs) this.done = true;
    }
    const elapsed = this.start === null ? 0 : Math.min(this.durationMs, this.items[this.items.length - 1].t - this.start);
    return { progress: elapsed / this.durationMs, done: this.done, frames: this.items.length };
  }

  toJSON(meta: { settings: TeleopControlSettings; startedAt: string }): TraceFile {
    const first = this.items[0];
    return {
      kind: "pm-hand-trace",
      version: TRACE_VERSION,
      startedAt: meta.startedAt,
      durationMs: this.durationMs,
      frameWidth: first ? first.frame[0] : null,
      frameHeight: first ? first.frame[1] : null,
      settings: meta.settings,
      frames: this.items,
    };
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** pm-hand-trace-YYYY-MM-DD-HHMMSS.json, local time. */
export function traceFileName(d: Date): string {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `pm-hand-trace-${day}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
}
