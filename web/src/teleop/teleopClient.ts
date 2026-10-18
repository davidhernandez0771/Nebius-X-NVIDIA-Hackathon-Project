// Browser end of the teleop link: HandFrame -> HandPoseMsg -> WebSocket
// /ws/teleop?role=browser (backend src/app/routers/teleop.py relays to the sim).
//
// Throttle, measured on HandFrame.timestamp (never wall-clock):
//   - about one message per MIN_INTERVAL_MS (~30 per second). A frame counts as due JITTER_MS early,
//     because rAF frame timestamps jitter: without the slack, a frame 32.4 ms after the last send was
//     dropped and the next one went out 66 ms after it (30 fps loop) or 50 ms (60 fps loop);
//   - with no hand, tracking_ok:false at most once per LOST_INTERVAL_MS (5 per
//     second). The first loss is sent at once so the sim latch holds promptly.
// Messages are dropped, not queued, while the socket is not open: a stale pose
// is worse than none.
//
// Latency trace (off unless constructed with { trace: true }; the Record page's ?latency=1): each hand
// pose also carries trace: {cap, send}, epoch ms of the frame going into MediaPipe and of the send. The
// relay and the sim add their own stamps (sim_worker/teleop_trace.py); the hand fields are unchanged.

import type { HandFrame, TrackedHand } from "../hand/contracts";
import type { TeleopControlSettings } from "./controlRegion";
import { toHandPoseMsg, type HandPoseMsg } from "./handPoseMessage";

export const MIN_INTERVAL_MS = 33;
export const JITTER_MS = 8; // < half a 60 fps frame, so a 60 fps loop still sends every second frame
export const LOST_INTERVAL_MS = 200;
const SOCKET_OPEN = 1; // WebSocket.OPEN

export interface TeleopStatus {
  socketOpen: boolean;
  simConnected: boolean;
  lastError: string | null; // the backend's latest validation error, if any
}

export interface TeleopClientOptions {
  trace?: boolean; // add latency stamps to each hand pose
}

/** The latency trace (the trace option) is on for a page opened with ?latency=1. */
export function latencyTraceRequested(search: string): boolean {
  return new URLSearchParams(search).get("latency") === "1";
}

/** Epoch ms of the frame (performance.now() timebase) and of now: the clock the relay and the sim share. */
function traceStamps(frameTimestamp: number): { cap: number; send: number } {
  const send = Date.now();
  return { cap: send - (performance.now() - frameTimestamp), send };
}

type ServerMessage = { type: "status"; sim_connected: boolean } | { type: "error"; detail: string };

function pickHand(hands: TrackedHand[]): TrackedHand | null {
  return hands.find((h) => h.handedness === "Right") ?? hands[0] ?? null;
}

export class TeleopClient {
  private readonly socket: WebSocket;
  private readonly listeners = new Set<(status: TeleopStatus) => void>();
  private status: TeleopStatus = { socketOpen: false, simConnected: false, lastError: null };
  private last: HandPoseMsg | undefined;
  private lastSentAt: number | null = null;
  private lastLostSentAt: number | null = null;
  private control: TeleopControlSettings | null = null;

  private readonly trace: boolean;

  constructor(url: string, WebSocketImpl: typeof WebSocket = WebSocket, options: TeleopClientOptions = {}) {
    this.trace = options.trace === true;
    this.socket = new WebSocketImpl(url);
    this.socket.onopen = () => this.setStatus({ socketOpen: true });
    this.socket.onclose = () => this.setStatus({ socketOpen: false, simConnected: false });
    this.socket.onmessage = (ev: MessageEvent) => this.handleServerMessage(ev.data);
  }

  /** grip: the page's pinch latch state (pinch.ts), sent as HandPoseMsg.grip; omitted: no grip field. */
  push(frame: HandFrame, grip?: 0 | 1): void {
    const t = frame.timestamp;
    if (this.lastSentAt !== null && t - this.lastSentAt < MIN_INTERVAL_MS - JITTER_MS) return;

    const msg = toHandPoseMsg(pickHand(frame.hands), frame, this.last, this.control);
    delete msg.grip; // a lost hand's message copies the last one, grip included
    if (grip !== undefined) msg.grip = grip;
    if (!msg.tracking_ok && this.lastLostSentAt !== null && t - this.lastLostSentAt < LOST_INTERVAL_MS) return;
    if (this.socket.readyState !== SOCKET_OPEN) return;

    this.socket.send(JSON.stringify(this.trace ? { ...msg, trace: traceStamps(t) } : msg));
    this.last = msg;
    this.lastSentAt = t;
    this.lastLostSentAt = msg.tracking_ok ? null : t;
  }

  /** Control-region settings for the optional HandPoseMsg.control; null sends none (the sim's own mapping). */
  setControl(settings: TeleopControlSettings | null): void {
    this.control = settings;
  }

  /** Subscribe to connection status; returns unsubscribe. */
  onStatus(cb: (status: TeleopStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close(): void {
    this.socket.close();
  }

  private handleServerMessage(data: unknown): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(data)) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === "status") this.setStatus({ simConnected: msg.sim_connected });
    else if (msg.type === "error") this.setStatus({ lastError: msg.detail });
  }

  private setStatus(patch: Partial<TeleopStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const cb of this.listeners) cb(this.status);
  }
}
