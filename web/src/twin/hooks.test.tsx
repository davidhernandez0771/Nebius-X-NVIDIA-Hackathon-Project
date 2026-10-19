import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../sant/motion/MotionProvider";
import { RETRY_MS, useLiveTwin } from "./useLiveTwin";
import { useReplayTwin, useVerifiedCopies } from "./useReplayTwin";

const NAMES = ["panda_joint1", "panda_finger_joint1"];

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  send(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop() {
    this.onclose?.();
  }
}

const WS = FakeSocket as unknown as typeof WebSocket;

beforeEach(() => {
  FakeSocket.all = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useLiveTwin", () => {
  it("poses from the relay's twin socket and reconnects when it drops", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useLiveTwin({ url: "ws://x/ws/teleop?role=twin", WebSocketImpl: WS }));
    const s = FakeSocket.all[0];
    expect(s.url).toBe("ws://x/ws/teleop?role=twin");
    expect(result.current.status).toBe("connecting");
    act(() => {
      s.open();
      s.send({ type: "status", sim_connected: true });
      s.send({ type: "sim_twin_scene", robot: "franka", joint_names: NAMES, base: [0, 0, 0, 1, 0, 0, 0], bin: [0.5, 0.3, 0, 1, 0, 0, 0] });
      s.send({ type: "sim_twin", q: [0.25, 0.04], gripper: 0, cube: [0.5, 0, 0.025, 1, 0, 0, 0] });
    });
    expect(result.current.status).toBe("live");
    expect(result.current.joints).toEqual({ panda_joint1: 0.25, panda_finger_joint1: 0.04 });

    act(() => s.drop());
    expect(result.current.status).toBe("offline");
    expect(FakeSocket.all).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(RETRY_MS));
    expect(FakeSocket.all).toHaveLength(2);

    unmount();
    expect(FakeSocket.all[1].closed).toBe(true);
    act(() => void vi.advanceTimersByTime(RETRY_MS * 3));
    expect(FakeSocket.all).toHaveLength(2); // no reconnecting after unmount
  });

  it("opens nothing while disabled", () => {
    renderHook(() => useLiveTwin({ enabled: false, WebSocketImpl: WS }));
    expect(FakeSocket.all).toHaveLength(0);
  });
});

const EPISODE = {
  demo_id: "copy_1",
  source: "variant",
  robot: "franka",
  fps: 50,
  n_steps: 3,
  joint_names: NAMES,
  joint_pos: [
    [0.1, 0.04],
    [0.2, 0.03],
    [0.3, 0.02],
  ],
  gripper: [0, 1, 1],
  cube_pos: null,
  cube_quat: [1, 0, 0, 0],
  bin: [0.5, 0.3, 0, 1, 0, 0, 0],
  base: [0, 0, 0, 1, 0, 0, 0],
  verified: true,
  lineage: ["human_1", "copy_1"],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function reducedMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", vi.fn((q: string) => ({ matches: reduced, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  return ({ children }: { children: ReactNode }) => <MotionProvider>{children}</MotionProvider>;
}

describe("useReplayTwin", () => {
  it("loads a saved episode and plays it", async () => {
    const fetchImpl = vi.fn(async () => json(EPISODE)) as unknown as typeof fetch;
    const raf: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => raf.push(cb));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { result } = renderHook(() => useReplayTwin("copy_1", { fetchImpl }), { wrapper: reducedMotion(false) });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/\/twin\/episodes\/copy_1$/);
    expect(result.current.playing).toBe(true);
    expect(result.current.twin.joints).toEqual({ panda_joint1: 0.1, panda_finger_joint1: 0.04 });
    expect(result.current.base?.pos).toEqual([0, 0, 0]);
    act(() => raf.shift()!(1000));
    act(() => raf.shift()!(1050)); // 50 ms in: step 2
    expect(result.current.step).toBe(2);
    expect(result.current.twin.gripper).toBe(1);
    act(() => result.current.seek(1));
    expect(result.current.twin.joints?.panda_joint1).toBe(0.2);
  });

  it("waits for play() when motion is reduced", async () => {
    const fetchImpl = vi.fn(async () => json(EPISODE)) as unknown as typeof fetch;
    const { result } = renderHook(() => useReplayTwin("copy_1", { fetchImpl }), { wrapper: reducedMotion(true) });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.playing).toBe(false);
    expect(result.current.step).toBe(0);
  });

  it("says what went wrong", async () => {
    const fetchImpl = vi.fn(async () => json({ detail: "demo 'x' has no recorded episode" }, 409)) as unknown as typeof fetch;
    const { result } = renderHook(() => useReplayTwin("x", { fetchImpl }), { wrapper: reducedMotion(false) });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/no recorded episode/);
    expect(result.current.twin.joints).toBeNull();
  });

  it("plays a static episode file, without the store", async () => {
    const fetchImpl = vi.fn(async () => json(EPISODE)) as unknown as typeof fetch;
    const { result } = renderHook(() => useReplayTwin(null, { fetchImpl, url: "/world/demo-episode.json" }), { wrapper: reducedMotion(true) });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/world/demo-episode.json");
    expect(result.current.episode?.demoId).toBe(EPISODE.demo_id);
    expect(result.current.twin.joints).toEqual({ panda_joint1: 0.1, panda_finger_joint1: 0.04 });
  });

  it("does nothing without an episode", () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { result } = renderHook(() => useReplayTwin(null, { fetchImpl }), { wrapper: reducedMotion(false) });
    expect(result.current.status).toBe("idle");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("useVerifiedCopies", () => {
  it("lists the store's verified copies for the robot", async () => {
    const rows = [{ id: "copy_2", source: "variant", robot: "franka", n_steps: 605, fps: 50, verified: true, lineage: ["s1_0004", "copy_2"] }];
    const fetchImpl = vi.fn(async () => json(rows)) as unknown as typeof fetch;
    const { result } = renderHook(() => useVerifiedCopies("franka", { fetchImpl }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.copies).toEqual([{ id: "copy_2", source: "variant", robot: "franka", nSteps: 605, fps: 50, verified: true, lineage: ["s1_0004", "copy_2"] }]);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/\/twin\/episodes\?verified=true&robot=franka&limit=20$/);
  });
});
