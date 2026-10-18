// The overlay's frame loop and props wiring, against a fake renderer (jsdom has no WebGL).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { HandLandmark } from "../../hand/contracts";

const fake = vi.hoisted(() => ({
  fail: false,
  instances: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
}));

vi.mock("./renderer", () => ({
  HandArtRenderer: function FakeRenderer() {
    if (fake.fail) throw new Error("Error creating WebGL context.");
    const r = {
      setHand: vi.fn(),
      setMirrored: vi.fn(),
      setCycleOptions: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      frame: vi.fn(() => ({
        cycle: { a: "ascii", b: "bayer", mix: 0.5, morphing: true },
        width: 640,
        height: 480,
        cpuMs: 0.4,
        gpuMs: [1.5],
        drew: true,
      })),
    };
    fake.instances.push(r);
    return r;
  },
}));

import HandArtOverlay from "./HandArtOverlay";

const hand: HandLandmark[] = Array.from({ length: 21 }, (_, i) => ({ x: 0.4 + i * 0.01, y: 0.5, z: 0 }));
let frames: FrameRequestCallback[] = [];
let now = 0;

const tick = (ms = 16) =>
  act(() => {
    now += ms;
    const due = frames;
    frames = [];
    due.forEach((f) => f(now));
  });

beforeEach(() => {
  fake.fail = false;
  fake.instances = [];
  frames = [];
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
  vi.stubGlobal("cancelAnimationFrame", () => (frames = []));
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HandArtOverlay", () => {
  it("draws a decorative canvas that takes no pointer input", () => {
    const { container } = render(<HandArtOverlay landmarks={hand} />);
    const canvas = container.querySelector("canvas")!;
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.className).toContain("hand-art");
  });

  it("renders nothing when WebGL is unavailable", () => {
    fake.fail = true;
    const { container } = render(<HandArtOverlay landmarks={hand} />);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("feeds the landmarks and gripper prop to the renderer every frame", () => {
    render(<HandArtOverlay landmarks={hand} gripperClosed />);
    tick();
    const r = fake.instances[0];
    expect(r.setHand).toHaveBeenLastCalledWith(hand, true, 0);
    expect(r.setMirrored).toHaveBeenLastCalledWith(true);
    expect(r.frame).toHaveBeenCalledTimes(1);
  });

  it("polls `source` once per frame instead of the props", () => {
    const source = vi.fn(() => ({ landmarks: hand, gripperClosed: false, cue: 3 }));
    render(<HandArtOverlay landmarks={null} source={source} />);
    tick();
    tick();
    expect(source).toHaveBeenCalledTimes(2);
    expect(fake.instances[0].setHand).toHaveBeenLastCalledWith(hand, false, 3);
  });

  it("passes a picked style and reduced motion to the style cycle", () => {
    const { rerender } = render(<HandArtOverlay landmarks={hand} style="halftone" reducedMotion={false} />);
    tick();
    const r = fake.instances[0];
    expect(r.setCycleOptions).toHaveBeenLastCalledWith(expect.objectContaining({ pinned: "halftone", reducedMotion: false }));
    rerender(<HandArtOverlay landmarks={hand} style="auto" reducedMotion />);
    tick();
    expect(r.setCycleOptions).toHaveBeenLastCalledWith(expect.objectContaining({ pinned: null, reducedMotion: true }));
  });

  it("passes the event trigger, cooldown and morph time to the style cycle", () => {
    render(<HandArtOverlay landmarks={hand} trigger="events" cooldownMs={400} morphMs={400} />);
    tick();
    expect(fake.instances[0].setCycleOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ trigger: "events", cooldownMs: 400, morphMs: 400 }),
    );
  });

  it("tells the page whether it is drawing (no WebGL: false, so Record keeps its 2D skeleton)", () => {
    const onActive = vi.fn();
    const { unmount } = render(<HandArtOverlay landmarks={hand} onActiveChange={onActive} />);
    expect(onActive).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onActive).toHaveBeenLastCalledWith(false);
    fake.fail = true;
    const failed = vi.fn();
    render(<HandArtOverlay landmarks={hand} onActiveChange={failed} />);
    expect(failed).toHaveBeenLastCalledWith(false);
    expect(failed).not.toHaveBeenCalledWith(true);
  });

  it("reports frame stats about twice a second", () => {
    const onStats = vi.fn();
    render(<HandArtOverlay landmarks={hand} onStats={onStats} />);
    for (let i = 0; i < 40; i++) tick(16);
    expect(onStats).toHaveBeenCalledTimes(1);
    expect(onStats.mock.calls[0][0]).toMatchObject({ width: 640, height: 480, styleA: "ascii", styleB: "bayer", morphing: true, gpuMeanMs: 1.5 });
    expect(onStats.mock.calls[0][0].fps).toBeCloseTo(62.5, 0);
  });

  it("stops and frees the GPU on unmount", () => {
    const { unmount } = render(<HandArtOverlay landmarks={hand} />);
    unmount();
    expect(fake.instances[0].dispose).toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });
});
