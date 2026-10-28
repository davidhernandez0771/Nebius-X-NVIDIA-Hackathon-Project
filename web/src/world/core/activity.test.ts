import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A display's frames, driven by hand: each frame() runs the callbacks waiting for it, at its time. */
function display(hz: number) {
  let now = 10_000;
  let queue: FrameRequestCallback[] = [];
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (queue.push(cb), queue.length));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return {
    frame() {
      now += 1000 / hz;
      const run = queue;
      queue = [];
      run.forEach((cb) => cb(now));
    },
    get now() {
      return now;
    },
  };
}

describe("idle loops (ambient)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks for every frame while the visitor is doing something", async () => {
    const d = display(120);
    const { ambient, markActive } = await import("./activity");
    markActive();
    const invalidate = vi.fn();
    for (let i = 0; i < 10; i++) {
      ambient(invalidate);
      d.frame();
    }
    expect(invalidate).toHaveBeenCalledTimes(10);
  });

  it("idle on high and ultra: 60 frames a second, every other frame of a 120 Hz display", async () => {
    const d = display(120);
    const { ambient, setIdleFps } = await import("./activity");
    setIdleFps(60);
    for (let i = 0; i < 500; i++) d.frame(); // past the idle wait, nothing touched
    const invalidate = vi.fn(() => ambient(invalidate));
    ambient(invalidate);
    const t0 = d.now;
    for (let i = 0; i < 120; i++) d.frame();
    const fps = invalidate.mock.calls.length / ((d.now - t0) / 1000);
    expect(fps).toBeGreaterThan(57);
    expect(fps).toBeLessThan(62);
  });

  it("idle on low: 30 a second", async () => {
    const d = display(120);
    const { ambient, setIdleFps } = await import("./activity");
    setIdleFps(30);
    for (let i = 0; i < 500; i++) d.frame();
    const invalidate = vi.fn(() => ambient(invalidate));
    ambient(invalidate);
    const t0 = d.now;
    for (let i = 0; i < 240; i++) d.frame();
    const fps = invalidate.mock.calls.length / ((d.now - t0) / 1000);
    expect(fps).toBeGreaterThan(28);
    expect(fps).toBeLessThan(31);
  });

  it("on a 60 Hz display at the 60 idle rate, every frame", async () => {
    const d = display(60);
    const { ambient, setIdleFps } = await import("./activity");
    setIdleFps(60);
    for (let i = 0; i < 300; i++) d.frame();
    const invalidate = vi.fn(() => ambient(invalidate));
    ambient(invalidate);
    for (let i = 0; i < 60; i++) d.frame();
    expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(59);
  });
});
