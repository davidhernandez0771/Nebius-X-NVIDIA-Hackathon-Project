import { describe, expect, it } from "vitest";

import { FRAME, makeHandPose } from "./__fixtures__/handPoses";
import { DEFAULT_TELEOP_CONTROL } from "./controlRegion";
import { DebugTrace, TRACE_SECONDS, TRACE_VERSION, traceFileName, traceFrame, type TraceSignals } from "./debugTrace";
import { toHandPoseMsg } from "./handPoseMessage";
import type { HandFrame, TrackedHand } from "../../hand/contracts";

function hand(): TrackedHand {
  const { world, landmarks } = makeHandPose();
  return { landmarks, worldLandmarks: world, handedness: "Right" };
}
const frameAt = (t: number, h: TrackedHand | null): HandFrame => ({ timestamp: t, frameWidth: FRAME.w, frameHeight: FRAME.h, hands: h ? [h] : [] });
const SIGNALS: TraceSignals = {
  pinch: 1.234567891,
  gripper: 0,
  victory: 0.1234567,
  size3d: 0.1111111,
  reachSize: 0.1050505,
  stable: 0.1040404,
  clutch: true,
  reach3d: false,
  breakthrough: 2,
  breakthroughDir: -1,
};

function entry(t: number, h: TrackedHand | null, signals: TraceSignals = SIGNALS) {
  const f = frameAt(t, h);
  return traceFrame(f, h, toHandPoseMsg(h, f, undefined, DEFAULT_TELEOP_CONTROL), signals);
}

describe("traceFrame", () => {
  it("keeps what we tune from: landmarks, world landmarks, pinch, V sign, both reach signals, what was sent", () => {
    const e = entry(1234, hand());
    expect([e.t, e.hands, e.handedness]).toEqual([1234, 1, "Right"]);
    expect(e.frame).toEqual([FRAME.w, FRAME.h]);
    expect(e.landmarks).toHaveLength(21);
    expect(e.world).toHaveLength(21);
    expect(e.pinch).toBe(1.23457); // the 2D pinch gap (pinch.ts)
    expect(e.victory).toBe(0.12346);
    expect(e.reach).toEqual({ palmWidth: expect.any(Number), size3d: 0.11111, stable: 0.10404, used: 0.10505, reach3d: false });
    expect(e.clutch).toBe(true);
    expect(e.reach.palmWidth).toBeGreaterThan(0);
    expect(e.breakthrough).toEqual({ count: 2, dir: -1 });
    expect(e.sent.tracking_ok).toBe(true);
    expect(e.sent.control).toHaveLength(3);
    expect(e.gripper).toBe(0);
  });

  it("is version 5: adds the pinch-stable size and the clutch (4: the hand lock and every detection)", () => {
    expect(TRACE_VERSION).toBe(5);
  });

  it("records every detection (label, palm center) and the lock, so a live trace is a hand-lock fixture", () => {
    const other: TrackedHand = { ...hand(), handedness: "Left", landmarks: hand().landmarks.map((p) => ({ ...p, x: p.x - 0.3 })) };
    const f: HandFrame = { ...frameAt(500, hand()), hands: [other, hand()] };
    const lock = { phase: "holding" as const, handedness: "Right" as const, progress: 1, held: "glitch" as const };
    const e = traceFrame(f, hand(), toHandPoseMsg(hand(), f, undefined, DEFAULT_TELEOP_CONTROL), { ...SIGNALS, lock });
    expect(e.hands).toBe(2);
    expect(e.seen.map((s) => s.handedness)).toEqual(["Left", "Right"]);
    expect(e.seen[0].palm[0]).toBeCloseTo(e.seen[1].palm[0] - 0.3, 4);
    expect(e.lock).toEqual({ phase: "holding", handedness: "Right", held: "glitch" });
  });

  it("records no lock when none is given", () => {
    expect(entry(0, hand()).lock).toBeNull();
  });

  it("rounds to 5 decimals, so ten seconds stay small", () => {
    const e = entry(0, hand());
    for (const v of [...e.landmarks!.flat(), ...e.world!.flat()]) expect(Math.abs(v * 1e5 - Math.round(v * 1e5))).toBeLessThan(1e-6);
  });

  it("records a frame without a hand as nulls", () => {
    const e = entry(0, null, { ...SIGNALS, pinch: null, victory: null, size3d: null, reachSize: null });
    expect([e.hands, e.landmarks, e.world, e.handedness, e.pinch, e.reach.palmWidth]).toEqual([0, null, null, null, null, null]);
    expect(e.sent.tracking_ok).toBe(false);
  });
});

describe("DebugTrace", () => {
  it(`collects ${TRACE_SECONDS} s of frames from the first one, then stops`, () => {
    const trace = new DebugTrace();
    let state = trace.push(entry(5000, hand()));
    expect(state).toMatchObject({ done: false, frames: 1, progress: 0 });
    for (let t = 5033; t < 5000 + TRACE_SECONDS * 1000; t += 33) state = trace.push(entry(t, hand()));
    expect(state.done).toBe(false);
    state = trace.push(entry(5000 + TRACE_SECONDS * 1000, hand()));
    expect(state.done).toBe(true);
    expect(trace.push(entry(99_000, hand())).frames).toBe(state.frames);
  });

  it("writes a self-describing file: kind, version, when, the settings, the frames", () => {
    const trace = new DebugTrace(100);
    for (let t = 0; t <= 100; t += 33) trace.push(entry(t, hand()));
    const file = trace.toJSON({ settings: DEFAULT_TELEOP_CONTROL, startedAt: "2026-10-17T20:00:00.000Z" });
    expect(file).toMatchObject({ kind: "pm-hand-trace", version: 5, startedAt: "2026-10-17T20:00:00.000Z", frameWidth: FRAME.w });
    expect(file.settings).toEqual(DEFAULT_TELEOP_CONTROL);
    expect(file.frames).toHaveLength(4);
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
  });

  it("names the file by its local start time", () => {
    expect(traceFileName(new Date(2026, 9, 17, 9, 5, 7))).toBe("pm-hand-trace-2026-10-17-090507.json");
  });
});
