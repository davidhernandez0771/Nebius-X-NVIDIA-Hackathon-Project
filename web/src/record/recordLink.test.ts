import { describe, expect, it } from "vitest";
import type { HandLandmark } from "../hand/contracts";
import { DEFAULT_TELEOP_CONTROL } from "./teleop/controlRegion";
import { latencyTraceRequested } from "./teleop/teleopClient";
import { RecordLink, controlMessage, parseSimStatus } from "./recordLink";

/** A stand-in WebSocket: records what is sent, and lets a test open it and deliver messages. */
class FakeSocket extends EventTarget {
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor(readonly url: string) {
    super();
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  deliver(data: unknown) {
    const ev = new MessageEvent("message", { data: JSON.stringify(data) });
    this.onmessage?.(ev);
    this.dispatchEvent(ev);
  }
}

const Impl = FakeSocket as unknown as typeof WebSocket;
const simStatus = { type: "sim_status", recording: true, steps: 12, demo_id: null, last_result: "recording", paused: false };

describe("parseSimStatus", () => {
  it("reads the relay's sim_status message", () => {
    expect(parseSimStatus(JSON.stringify(simStatus))).toEqual({
      recording: true,
      steps: 12,
      demoId: null,
      lastResult: "recording",
      paused: false,
    });
  });

  it("ignores other messages and garbage", () => {
    expect(parseSimStatus(JSON.stringify({ type: "status", sim_connected: true }))).toBeNull();
    expect(parseSimStatus("not json")).toBeNull();
    expect(parseSimStatus(JSON.stringify({ type: "sim_status", recording: "yes" }))).toBeNull();
  });

  it("treats a missing paused flag as not paused", () => {
    const { paused: _p, ...old } = simStatus;
    expect(parseSimStatus(JSON.stringify(old))?.paused).toBe(false);
  });
});

describe("controlMessage", () => {
  it("is the relay's ControlMsg", () => {
    expect(JSON.parse(controlMessage("record_start"))).toEqual({ type: "control", action: "record_start" });
  });
});

describe("RecordLink", () => {
  it("shares one socket with the teleop client", () => {
    const link = new RecordLink("ws://relay", Impl);
    expect(FakeSocket.last?.url).toBe("ws://relay");
    link.close();
  });

  it("sends a control only while the socket is open", () => {
    const link = new RecordLink("ws://relay", Impl);
    const sock = FakeSocket.last!;
    expect(link.sendControl("record_start")).toBe(false);
    expect(sock.sent).toEqual([]);
    sock.open();
    expect(link.sendControl("record_start")).toBe(true);
    expect(sock.sent.map((s) => JSON.parse(s))).toEqual([{ type: "control", action: "record_start" }]);
    link.close();
  });

  it("delivers sim_status to listeners, and the teleop status still flows", () => {
    const link = new RecordLink("ws://relay", Impl);
    const sock = FakeSocket.last!;
    const sims: unknown[] = [];
    const teleops: boolean[] = [];
    link.onSimStatus((s) => sims.push(s));
    link.onStatus((s) => teleops.push(s.simConnected));
    sock.open();
    sock.deliver({ type: "status", sim_connected: true });
    sock.deliver(simStatus);
    expect(teleops[teleops.length - 1]).toBe(true);
    expect(sims).toEqual([{ recording: true, steps: 12, demoId: null, lastResult: "recording", paused: false }]);
    link.close();
  });

  it("forgets the sim status when the sim disconnects", () => {
    const link = new RecordLink("ws://relay", Impl);
    const sock = FakeSocket.last!;
    const sims: unknown[] = [];
    link.onSimStatus((s) => sims.push(s));
    sock.open();
    sock.deliver(simStatus);
    sock.deliver({ type: "status", sim_connected: false });
    expect(sims[sims.length - 1]).toBeNull();
    link.close();
  });

  it("stops delivering after close", () => {
    const link = new RecordLink("ws://relay", Impl);
    const sock = FakeSocket.last!;
    const sims: unknown[] = [];
    link.onSimStatus((s) => sims.push(s));
    link.close();
    sock.deliver(simStatus);
    expect(sims).toEqual([]);
  });

  it("passes control-region settings through to the hand poses it sends", () => {
    const link = new RecordLink("ws://relay", Impl);
    const sock = FakeSocket.last!;
    sock.open();
    const landmarks: HandLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    landmarks[5] = { x: 0.45, y: 0.5, z: 0 };
    landmarks[17] = { x: 0.55, y: 0.5, z: 0 };
    const frame = (t: number) => ({ timestamp: t, frameWidth: 640, frameHeight: 480, hands: [{ landmarks, handedness: "Right" as const }] });
    link.push(frame(0));
    link.setControl(DEFAULT_TELEOP_CONTROL);
    link.push(frame(100));
    const sent = sock.sent.map((m) => JSON.parse(m));
    expect(sent.map((m) => "control" in m)).toEqual([false, true]);
    link.close();
  });

  it("passes the page's grip through to the hand poses it sends", () => {
    const link = new RecordLink("ws://relay", Impl);
    const sock = FakeSocket.last!;
    sock.open();
    const landmarks: HandLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    landmarks[5] = { x: 0.45, y: 0.5, z: 0 };
    landmarks[17] = { x: 0.55, y: 0.5, z: 0 };
    const frame = (t: number) => ({ timestamp: t, frameWidth: 640, frameHeight: 480, hands: [{ landmarks, handedness: "Right" as const }] });
    link.push(frame(0), 1);
    expect(JSON.parse(sock.sent[0]).grip).toBe(1);
    link.close();
  });

  it("adds latency stamps to the hand poses only when asked", () => {
    const landmarks: HandLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    landmarks[5] = { x: 0.45, y: 0.5, z: 0 };
    landmarks[17] = { x: 0.55, y: 0.5, z: 0 };
    const frame = { timestamp: 0, frameWidth: 640, frameHeight: 480, hands: [{ landmarks, handedness: "Right" as const }] };
    const sent = (opts?: { trace?: boolean }) => {
      const link = new RecordLink("ws://relay", Impl, opts);
      const sock = FakeSocket.last!;
      sock.open();
      link.push(frame);
      link.close();
      return JSON.parse(sock.sent[0]);
    };
    expect(sent().trace).toBeUndefined();
    expect(Object.keys(sent({ trace: true }).trace).sort()).toEqual(["cap", "send"]);
  });
});

describe("latencyTraceRequested", () => {
  it("is on only for ?latency=1", () => {
    expect(latencyTraceRequested("?latency=1")).toBe(true);
    expect(latencyTraceRequested("?x=2&latency=1")).toBe(true);
    expect(latencyTraceRequested("")).toBe(false);
    expect(latencyTraceRequested("?latency=0")).toBe(false);
  });
});
