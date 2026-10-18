// The Record page's link to the sim (plan sprint 3c, T5 Tasks 1 and 4). One WebSocket to the relay
// (src/app/routers/teleop.py, role=browser) carries three things:
//   - hand poses, through the existing TeleopClient (throttling, tracking-lost messages);
//   - control messages, {"type": "control", "action": ...}, sent from here;
//   - the sim's {"type": "sim_status", ...}, read here.
// The relay allows one browser connection, and TeleopClient (web/src/teleop, not this track's)
// has no control API. So RecordLink hands TeleopClient a WebSocket subclass that captures the
// socket it creates, and adds its own "message" listener beside TeleopClient's onmessage.

import type { HandFrame } from "../../hand/contracts";
import type { TeleopControlSettings } from "../../teleop/controlRegion";
import { TeleopClient, type TeleopClientOptions, type TeleopStatus } from "../../teleop/teleopClient";

export type ControlAction = "record_start" | "record_stop" | "reset_scene";

/** The relay's SimStatusMsg, camelCased. */
export interface SimStatus {
  recording: boolean;
  steps: number; // control steps recorded, 50 Hz sim time
  demoId: string | null; // the last saved demo
  lastResult: string | null;
  paused: boolean; // recording, but held because hand tracking was lost
}

const SOCKET_OPEN = 1; // WebSocket.OPEN

export function controlMessage(action: ControlAction): string {
  return JSON.stringify({ type: "control", action });
}

export function parseSimStatus(data: unknown): SimStatus | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(String(data)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (msg?.type !== "sim_status" || typeof msg.recording !== "boolean" || typeof msg.steps !== "number") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    recording: msg.recording,
    steps: msg.steps,
    demoId: str(msg.demo_id),
    lastResult: str(msg.last_result),
    paused: msg.paused === true,
  };
}

export class RecordLink {
  private readonly teleop: TeleopClient;
  private readonly socket: WebSocket | null;
  private readonly simListeners = new Set<(status: SimStatus | null) => void>();
  private simConnected = false;
  private closed = false;

  constructor(url: string, WebSocketImpl: typeof WebSocket = WebSocket, options: TeleopClientOptions = {}) {
    let captured: WebSocket | null = null;
    class Capturing extends WebSocketImpl {
      constructor(u: string | URL, protocols?: string | string[]) {
        super(u, protocols);
        captured = this;
      }
    }
    this.teleop = new TeleopClient(url, Capturing, options);
    this.socket = captured as WebSocket | null; // set by Capturing during the TeleopClient constructor
    this.socket?.addEventListener("message", this.handleMessage);
    this.teleop.onStatus((s) => {
      // The sim went away: its last status no longer describes anything.
      if (this.simConnected && !s.simConnected) this.emitSim(null);
      this.simConnected = s.simConnected;
    });
  }

  push(frame: HandFrame, grip?: 0 | 1): void {
    this.teleop.push(frame, grip);
  }

  /** Control-region settings for the hand poses (HandPoseMsg.control); null sends none. */
  setControl(settings: TeleopControlSettings | null): void {
    this.teleop.setControl(settings);
  }

  /** False when the socket isn't open, so nothing was sent. */
  sendControl(action: ControlAction): boolean {
    if (this.closed || !this.socket || this.socket.readyState !== SOCKET_OPEN) return false;
    this.socket.send(controlMessage(action));
    return true;
  }

  onStatus(cb: (status: TeleopStatus) => void): () => void {
    return this.teleop.onStatus(cb);
  }

  /** Each sim_status from the sim; null when the sim disconnects. Returns unsubscribe. */
  onSimStatus(cb: (status: SimStatus | null) => void): () => void {
    this.simListeners.add(cb);
    return () => this.simListeners.delete(cb);
  }

  close(): void {
    this.closed = true;
    this.socket?.removeEventListener("message", this.handleMessage);
    this.teleop.close();
  }

  private readonly handleMessage = (ev: MessageEvent) => {
    if (this.closed) return;
    const status = parseSimStatus(ev.data);
    if (!status) return;
    this.simConnected = true; // only a connected sim's status reaches the browser
    this.emitSim(status);
  };

  private emitSim(status: SimStatus | null): void {
    for (const cb of this.simListeners) cb(status);
  }
}
