import { describe, expect, it } from "vitest";
import { HAND_ART_STYLES, initialCycle, stepCycle, type CycleOptions, type CycleState } from "./styleCycle";

const opts = (o: Partial<CycleOptions> = {}): CycleOptions => ({
  holdMs: 1000,
  morphMs: 500,
  pinned: null,
  reducedMotion: false,
  staticStyle: "lines",
  ...o,
});

const run = (s: CycleState, ms: number, grip: boolean, o: CycleOptions, step = 16): CycleState => {
  for (let t = 0; t < ms; t += step) s = stepCycle(s, step, grip, o);
  return s;
};

describe("stepCycle, auto", () => {
  it("holds a style, then morphs to the next one", () => {
    let s = initialCycle(opts());
    expect(s.a).toBe(s.b);
    expect(s.mix).toBe(0);
    s = run(s, 900, false, opts());
    expect(s.morphing).toBe(false);
    s = run(s, 200, false, opts());
    expect(s.morphing).toBe(true);
    expect(s.b).not.toBe(s.a);
    expect(s.mix).toBeGreaterThan(0);
    const target = s.b;
    s = run(s, 600, false, opts());
    expect(s.morphing).toBe(false);
    expect(s.a).toBe(target);
    expect(s.b).toBe(target);
    expect(s.mix).toBe(0);
  });

  it("visits every style in turn", () => {
    let s = initialCycle(opts());
    const seen = new Set([s.a]);
    for (let i = 0; i < HAND_ART_STYLES.length * 2; i++) {
      s = run(s, 1600, false, opts());
      seen.add(s.a);
    }
    expect(seen.size).toBe(HAND_ART_STYLES.length);
  });

  it("morphs at once when the gripper opens or closes", () => {
    let s = initialCycle(opts());
    s = stepCycle(s, 16, false, opts());
    expect(s.morphing).toBe(false);
    s = stepCycle(s, 16, true, opts());
    expect(s.morphing).toBe(true);
    const seed = s.seed;
    // A second change mid-morph does not restart it.
    s = stepCycle(s, 16, false, opts());
    expect(s.seed).toBe(seed);
  });

  it("does not treat the first frame as a gripper change", () => {
    const s = stepCycle(initialCycle(opts()), 16, true, opts());
    expect(s.morphing).toBe(false);
  });

  it("changes the noise seed for each morph", () => {
    let s = initialCycle(opts());
    s = run(s, 1100, false, opts());
    const first = s.seed;
    s = run(s, 1600, false, opts());
    expect(s.seed).not.toBe(first);
  });
});

describe("stepCycle, pinned", () => {
  it("morphs to the pinned style and stays there", () => {
    const o = opts({ pinned: "halftone" });
    let s = initialCycle(opts({ pinned: null }));
    s = stepCycle(s, 16, false, o);
    expect(s.b).toBe("halftone");
    s = run(s, 5000, true, o);
    expect(s.a).toBe("halftone");
    expect(s.morphing).toBe(false);
  });
});

describe("stepCycle, reduced motion", () => {
  it("shows one static style and never morphs", () => {
    const o = opts({ reducedMotion: true });
    let s = initialCycle(o);
    expect(s.a).toBe("lines");
    s = run(s, 5000, false, o);
    s = stepCycle(s, 16, true, o);
    expect(s).toMatchObject({ a: "lines", b: "lines", mix: 0, morphing: false });
  });

  it("switches instantly to a picked style", () => {
    const o = opts({ reducedMotion: true, pinned: "ascii" });
    const s = stepCycle(initialCycle(opts({ reducedMotion: true })), 16, false, o);
    expect(s).toMatchObject({ a: "ascii", b: "ascii", mix: 0, morphing: false });
  });
});
