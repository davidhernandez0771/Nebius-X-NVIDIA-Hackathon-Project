import { describe, expect, it } from "vitest";

import type { HandFrame, HandLandmark, TrackedHand } from "../hand/contracts";
import fixture from "./__fixtures__/hand_pose_msg.json";
import { DEFAULT_TELEOP_CONTROL } from "./controlRegion";
import { toHandPoseMsg, type HandPoseMsg } from "./handPoseMessage";
import { TeleopClient, type TeleopStatus } from "./teleopClient";

// Unlisted landmarks sit at the frame center, except a default 128 px palm (landmarks 5 and 17),
// since a zero-width palm is reported as "no hand".
function makeHand(points: Record<number, [number, number]>, handedness: TrackedHand["handedness"] = "Right"): TrackedHand {
  const landmarks: HandLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const withPalm: Record<number, [number, number]> = { 5: [0.45, 0.5], 17: [0.55, 0.5], ...points };
  for (const [idx, [x, y]] of Object.entries(withPalm)) landmarks[Number(idx)] = { x, y, z: 0 };
  return { landmarks, handedness };
}

// Fixed landmarks behind __fixtures__/hand_pose_msg.json (values computed independently, by hand formula).
const FIXTURE_HAND = makeHand({ 0: [0.5, 0.75], 9: [0.55, 0.55], 5: [0.45, 0.6], 17: [0.55, 0.62], 4: [0.48, 0.5], 8: [0.5, 0.48] });
const HD = { timestamp: 1234.5, frameWidth: 1280, frameHeight: 720 };

describe("toHandPoseMsg", () => {
  it("palm_width aspect-correct on 1280x720", () => {
    // Landmarks 5 and 17 are 0.1 apart in u and 0.1 apart in v: 128 px and 72 px on a 1280x720 frame.
    const msg = toHandPoseMsg(makeHand({ 5: [0.4, 0.4], 17: [0.5, 0.5] }), HD);
    expect(msg.palm_width).toBeCloseTo(Math.hypot(128, 72) / 1280, 12);
    expect(msg.palm_width).not.toBeCloseTo(Math.hypot(0.1, 0.1), 3); // the naive normalized distance
  });

  it("pinch_ratio", () => {
    // Palm 128 px wide; thumb tip and index tip 32 px apart horizontally.
    const msg = toHandPoseMsg(makeHand({ 5: [0.4, 0.5], 17: [0.5, 0.5], 4: [0.3, 0.2], 8: [0.325, 0.2] }), HD);
    expect(msg.pinch_ratio).toBeCloseTo(32 / 128, 12);
  });

  it("yaw 0 for upright hand and +pi/2 for hand pointing raw-right", () => {
    const upright = toHandPoseMsg(makeHand({ 0: [0.5, 0.8], 9: [0.5, 0.5] }), HD);
    const right = toHandPoseMsg(makeHand({ 0: [0.3, 0.5], 9: [0.6, 0.5] }), HD);
    // 45 degrees on screen = equal pixel offsets, which are unequal normalized offsets on 16:9.
    const diagonal = toHandPoseMsg(makeHand({ 0: [0.5, 0.5], 9: [0.5 + 72 / 1280, 0.5 - 72 / 720] }), HD);
    expect(upright.yaw_rad).toBeCloseTo(0, 12);
    expect(right.yaw_rad).toBeCloseTo(Math.PI / 2, 12);
    expect(diagonal.yaw_rad).toBeCloseTo(Math.PI / 4, 12);
  });

  it("tracking_ok false with null hand keeps last values", () => {
    const tracked = toHandPoseMsg(FIXTURE_HAND, HD);
    const lost = toHandPoseMsg(null, { ...HD, timestamp: 2000 }, tracked);
    expect(lost).toEqual({ ...tracked, t_ms: 2000, tracking_ok: false });

    const neverSeen = toHandPoseMsg(null, { ...HD, timestamp: 5 });
    expect(neverSeen).toEqual({
      t_ms: 5, tracking_ok: false, wrist_uv: [0, 0], palm_width: 0, pinch_ratio: 0, yaw_rad: 0, frame_w: 1280, frame_h: 720,
    });
  });

  it("clamps wrist_uv into [0, 1] for a hand at the image edge", () => {
    const msg = toHandPoseMsg(makeHand({ 0: [1.03, -0.02] }), HD);
    expect(msg.wrist_uv).toEqual([1, 0]);
  });

  it("treats a degenerate palm (zero width) as no hand", () => {
    const msg = toHandPoseMsg(makeHand({ 5: [0.4, 0.4], 17: [0.4, 0.4] }), HD);
    expect(msg.tracking_ok).toBe(false);
  });

  it("adds no control field unless control settings are given and enabled", () => {
    const keys = ["frame_h", "frame_w", "palm_width", "pinch_ratio", "t_ms", "tracking_ok", "wrist_uv", "yaw_rad"];
    expect(Object.keys(toHandPoseMsg(FIXTURE_HAND, HD)).sort()).toEqual(keys);
    const off = { ...DEFAULT_TELEOP_CONTROL, enabled: false };
    expect(Object.keys(toHandPoseMsg(FIXTURE_HAND, HD, undefined, off)).sort()).toEqual(keys);
  });

  it("control is the palm center in the region plus depth, by hand formula", () => {
    const msg = toHandPoseMsg(FIXTURE_HAND, HD, undefined, DEFAULT_TELEOP_CONTROL);
    // Palm center = mean of landmarks 0, 5, 9, 17; default region x 0.225..0.775, y 0.15..0.70.
    const cx = (0.5 + 0.45 + 0.55 + 0.55) / 4;
    const cy = (0.75 + 0.6 + 0.55 + 0.62) / 4;
    expect(msg.control![0]).toBeCloseTo((cx - 0.225) / 0.55, 12);
    expect(msg.control![1]).toBeCloseTo((cy - 0.15) / 0.55, 12);
    expect(msg.control![2]).toBeCloseTo((msg.palm_width - 0.07) / (0.13 - 0.07), 12);
  });

  it("a lost hand keeps the last control, like the other fields", () => {
    const tracked = toHandPoseMsg(FIXTURE_HAND, HD, undefined, DEFAULT_TELEOP_CONTROL);
    const lost = toHandPoseMsg(null, { ...HD, timestamp: 2000 }, tracked, DEFAULT_TELEOP_CONTROL);
    expect(lost.control).toEqual(tracked.control);
    expect(lost.tracking_ok).toBe(false);
  });

  it("matches the committed cross-language fixture", () => {
    const msg = toHandPoseMsg(FIXTURE_HAND, HD, undefined, DEFAULT_TELEOP_CONTROL);
    expect(Object.keys(msg).sort()).toEqual(Object.keys(fixture).sort());
    for (let i = 0; i < 3; i++) expect(msg.control![i]).toBeCloseTo(fixture.control[i], 12);
    expect(msg.t_ms).toBe(fixture.t_ms);
    expect(msg.tracking_ok).toBe(fixture.tracking_ok);
    expect(msg.wrist_uv).toEqual(fixture.wrist_uv);
    expect(msg.frame_w).toBe(fixture.frame_w);
    expect(msg.frame_h).toBe(fixture.frame_h);
    for (const key of ["palm_width", "pinch_ratio", "yaw_rad"] as const) expect(msg[key]).toBeCloseTo(fixture[key], 12);
  });
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function frame(timestamp: number, hands: TrackedHand[] = [FIXTURE_HAND]): HandFrame {
  return { timestamp, hands, frameWidth: 1280, frameHeight: 720 };
}

function newClient(): { client: TeleopClient; socket: FakeSocket; sent: () => HandPoseMsg[] } {
  FakeSocket.instances = [];
  const client = new TeleopClient("ws://test/ws/teleop?role=browser", FakeSocket as unknown as typeof WebSocket);
  const socket = FakeSocket.instances[0];
  return { client, socket, sent: () => socket.sent.map((s) => JSON.parse(s) as HandPoseMsg) };
}

describe("TeleopClient", () => {
  it("throttle drops frames under 33 ms apart", () => {
    const { client, sent } = newClient();
    for (const t of [0, 10, 32, 33, 50, 66, 100]) client.push(frame(t));
    expect(sent().map((m) => m.t_ms)).toEqual([0, 33, 66, 100]);
  });

  it("sends tracking_ok false at most 5 times per second when no hand is present", () => {
    const { client, sent } = newClient();
    client.push(frame(0));
    for (let t = 40; t <= 1000; t += 40) client.push(frame(t, []));
    const lost = sent().filter((m) => !m.tracking_ok);
    expect(lost[0].t_ms).toBe(40); // the first loss goes out at once, so the sim latch holds promptly
    expect(lost.length).toBeLessThanOrEqual(6); // 40 ms + at most 5 more in the following ~1 s
    for (let i = 1; i < lost.length; i++) expect(lost[i].t_ms - lost[i - 1].t_ms).toBeGreaterThanOrEqual(200);
    expect(lost[0].palm_width).toBeGreaterThan(0); // last known values are kept
  });

  it("prefers the Right hand, else the first hand", () => {
    const left = makeHand({ 0: [0.1, 0.9] }, "Left");
    const right = makeHand({ 0: [0.7, 0.6] }, "Right");
    const { client, sent } = newClient();
    client.push(frame(0, [left, right]));
    client.push(frame(100, [left]));
    expect(sent().map((m) => m.wrist_uv)).toEqual([[0.7, 0.6], [0.1, 0.9]]);
  });

  it("sends control only after setControl, and stops after setControl(null)", () => {
    const { client, sent } = newClient();
    client.push(frame(0));
    client.setControl(DEFAULT_TELEOP_CONTROL);
    client.push(frame(100));
    client.setControl(null);
    client.push(frame(200));
    expect(sent().map((m) => m.control !== undefined)).toEqual([false, true, false]);
  });

  it("does not send while the socket is not open", () => {
    const { client, socket, sent } = newClient();
    socket.readyState = 0;
    client.push(frame(0));
    expect(sent()).toEqual([]);
  });

  it("reports socket and sim status, and server errors", () => {
    const { client, socket } = newClient();
    const seen: TeleopStatus[] = [];
    const unsubscribe = client.onStatus((s) => seen.push(s));
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: "status", sim_connected: true }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "error", detail: "bad wrist_uv" }) });
    unsubscribe();
    socket.onmessage?.({ data: JSON.stringify({ type: "status", sim_connected: false }) });

    expect(seen).toEqual([
      { socketOpen: true, simConnected: false, lastError: null },
      { socketOpen: true, simConnected: true, lastError: null },
      { socketOpen: true, simConnected: true, lastError: "bad wrist_uv" },
    ]);
    client.close();
    expect(socket.readyState).toBe(3);
  });
});
