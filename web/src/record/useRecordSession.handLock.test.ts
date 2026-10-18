// The hand lock wired into the Record session: fixture frames in through a fake tracker, the hand
// poses out through a fake relay socket, exactly what the sim would get.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { HandFrame, TrackingStatus } from "../hand/contracts";
import { MAIN, OTHER, recordFrames, twoHands } from "./teleop/__fixtures__/handLockFrames";

let emit: ((f: HandFrame) => void) | null = null;
vi.mock("../hand/tracking", () => ({
  createMediapipeTracker: () => ({
    start: async () => {},
    stop() {},
    cleanup() {
      emit = null;
    },
    onFrame(cb: (f: HandFrame) => void) {
      emit = cb;
      return () => {};
    },
    onStatus(_cb: (s: TrackingStatus) => void) {
      return () => {};
    },
  }),
}));

type Sent = { tracking_ok: boolean; wrist_uv: [number, number]; grip?: 0 | 1 };
const sent: Sent[] = [];
class FakeSocket {
  static readonly OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor(_url: string) {}
  send(data: string) {
    const msg = JSON.parse(data);
    if (msg.type === undefined) sent.push(msg);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

afterEach(() => {
  cleanup();
  sent.length = 0;
  vi.unstubAllGlobals();
});

async function startSession() {
  vi.stubGlobal("WebSocket", FakeSocket);
  const { useRecordSession } = await import("./useRecordSession");
  const hook = renderHook(() => useRecordSession());
  await act(async () => {
    await hook.result.current.start();
  });
  return hook;
}

function feed(frames: HandFrame[]) {
  act(() => {
    for (const f of frames) emit!(f);
  });
}

const mainWrist = (x: number) => x < 0.55; // MAIN's palm is left of 0.55 in the raw frame, OTHER's right

describe("Record session with the hand lock", () => {
  it("sends only the locked hand's pose, never the other one", async () => {
    await startSession();
    feed(twoHands);
    const tracked = sent.filter((m) => m.tracking_ok);
    expect(tracked.length).toBeGreaterThan(20);
    expect(tracked.every((m) => mainWrist(m.wrist_uv[0]))).toBe(true);
    // Before the lock (the first 0.3 s): nothing tracked was sent.
    expect(sent[0].tracking_ok).toBe(false);
  });

  it("holds the pose and the gripper while the locked hand is missing; the other hand moves nothing", async () => {
    await startSession();
    // MAIN pinched (gripper closed) and locked, then gone for ~0.4 s while OTHER, open, is in view.
    const frames = recordFrames(45, (i) => {
      if (i < 20) return [{ ...MAIN, pinched: true }];
      if (i < 32) return [OTHER];
      return [{ ...MAIN, pinched: true }, OTHER];
    });
    feed(frames);
    const last = sent.length;
    expect(last).toBeGreaterThan(20);
    const lockedAt = sent.findIndex((m) => m.tracking_ok);
    for (const m of sent.slice(lockedAt)) {
      expect(m.tracking_ok).toBe(true); // held frames still drive the arm: the same pose
      expect(m.grip).toBe(1);
      expect(mainWrist(m.wrist_uv[0])).toBe(true);
    }
  });

  it("the gripper stays as it was through a held frame even if the last pose was open", async () => {
    await startSession();
    // Closed, then open (wide gap) for 2 frames, then a 0.3 s loss: the latch must not finish
    // opening on the held, unchanged pose (it needs 150 ms of a wide gap actually seen).
    const frames = recordFrames(40, (i) => {
      if (i < 20) return [{ ...MAIN, pinched: true }];
      if (i < 22) return [MAIN];
      if (i < 31) return [];
      return [{ ...MAIN, pinched: true }];
    });
    feed(frames);
    const after = sent.filter((m) => m.tracking_ok).slice(-15);
    expect(after.every((m) => m.grip === 1)).toBe(true);
  });

  it("pose.lock reports the lock; repickHand drops it", async () => {
    const hook = await startSession();
    feed(recordFrames(20, () => [MAIN]));
    expect(hook.result.current.pose?.lock).toMatchObject({ phase: "locked", handedness: "Left" });
    act(() => hook.result.current.repickHand());
    feed(recordFrames(2, () => [MAIN], { t0: 5000 }));
    expect(hook.result.current.pose?.lock?.phase).toBe("searching");
  });

  it("before any lock the latest pose shows no landmarks", async () => {
    const hook = await startSession();
    feed(recordFrames(3, () => [MAIN, OTHER]));
    expect(hook.result.current.pose?.landmarks).toBeNull();
  });
});
