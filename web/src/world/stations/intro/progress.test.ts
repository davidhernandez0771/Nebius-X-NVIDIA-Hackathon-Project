import { describe, expect, it, vi } from "vitest";
import { FRAMES, STEPS, createLoad, frameGate } from "./progress";

describe("the loader's progress", () => {
  it("weighs the real steps of the first scene to 1, in the order they happen", () => {
    expect(Object.keys(STEPS)).toEqual(["engine", "fonts", "build", "shaders", "frames"]);
    expect(Object.values(STEPS).reduce((a, s) => a + s.weight, 0)).toBeCloseTo(1, 9);
  });

  it("counts each step's own measure (fonts loaded, programs compiled, steady frames) and never goes back", () => {
    const l = createLoad();
    const fn = vi.fn();
    l.subscribe(fn);
    l.set("engine", 1);
    expect(l.value()).toBeCloseTo(STEPS.engine.weight, 9);
    l.set("engine", 0.2);
    expect(l.value()).toBeCloseTo(STEPS.engine.weight, 9);
    l.count("fonts", 2, 4);
    expect(l.value()).toBeCloseTo(STEPS.engine.weight + STEPS.fonts.weight / 2, 9);
    l.count("shaders", 9, 36);
    l.count("shaders", 3, 36);
    expect(l.value()).toBeCloseTo(STEPS.engine.weight + STEPS.fonts.weight / 2 + STEPS.shaders.weight / 4, 9);
    l.count("fonts", 4, 4);
    l.set("build", 1);
    l.count("shaders", 36, 36);
    l.count("frames", FRAMES, FRAMES);
    expect(l.value()).toBeCloseTo(1, 9);
    expect(l.done()).toBe(true);
    // A repeat that changes nothing isn't news.
    const calls = fn.mock.calls.length;
    l.count("shaders", 36, 36);
    expect(fn.mock.calls.length).toBe(calls);
  });

  it("says what it is waiting for now, with its count", () => {
    const l = createLoad();
    expect(l.status()).toEqual({ step: "engine", label: "Loading the 3D engine", detail: "" });
    l.set("engine", 1);
    l.count("fonts", 1, 3);
    expect(l.status()).toEqual({ step: "fonts", label: "Loading the type", detail: "1 / 3" });
    l.count("fonts", 3, 3);
    l.set("build", 1);
    l.count("shaders", 12, 31);
    expect(l.status()).toEqual({ step: "shaders", label: "Compiling shaders", detail: "12 / 31" });
    l.count("shaders", 31, 31);
    l.count("frames", 1, FRAMES);
    expect(l.status()).toEqual({ step: "frames", label: "Warming up", detail: `1 / ${FRAMES} steady frames` });
    l.count("frames", FRAMES, FRAMES);
    expect(l.status()).toEqual({ step: null, label: "Ready", detail: "" });
  });

  it("can be let go early (continue anyway): it reads done, at what it had", () => {
    const l = createLoad();
    l.set("engine", 1);
    l.release();
    expect(l.done()).toBe(true);
    expect(l.value()).toBeCloseTo(STEPS.engine.weight, 9);
    expect(l.released()).toBe(true);
    l.reset();
    expect(l.done()).toBe(false);
    expect(l.released()).toBe(false);
    expect(l.value()).toBe(0);
  });
});

describe("the steady-frames gate", () => {
  it("counts the trailing frames within a third of their median: a hitch starts it again", () => {
    expect(frameGate([])).toEqual({ steady: 0, done: false });
    expect(frameGate([0.016, 0.017, 0.016])).toEqual({ steady: 3, done: true });
    // A long first frame (the shaders' first use) doesn't count; the steady ones after it do.
    expect(frameGate([0.4, 0.016, 0.017])).toEqual({ steady: 2, done: false });
    expect(frameGate([0.016, 0.017, 0.09, 0.016])).toEqual({ steady: 1, done: false });
  });

  it("judges the frame time against itself, so a slow software renderer can still be steady", () => {
    expect(frameGate([0.31, 0.28, 0.3]).done).toBe(true);
    expect(frameGate([0.31, 0.6, 0.3]).done).toBe(false);
  });

  it("gives up waiting after a dozen frames (a device that never settles still gets in)", () => {
    const noisy = Array.from({ length: 12 }, (_, i) => (i % 2 ? 0.05 : 0.016));
    expect(frameGate(noisy).done).toBe(true);
    expect(frameGate(noisy.slice(0, 11)).done).toBe(false);
  });
});
