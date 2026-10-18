import { describe, expect, it } from "vitest";
import {
  HAND_ART_STYLES,
  STATIC_AGE_MS,
  initialCycle,
  stepCycle,
  type CycleOptions,
  type CycleState,
  type HandArtStyle,
} from "./styleCycle";

const opts = (o: Partial<CycleOptions> = {}): CycleOptions => ({
  morphMs: 400,
  cooldownMs: 400,
  pinned: null,
  reducedMotion: false,
  staticStyle: "ink",
  ...o,
});

const run = (s: CycleState, ms: number, target: HandArtStyle, o: CycleOptions, step = 16): CycleState => {
  for (let t = 0; t < ms; t += step) s = stepCycle(s, step, target, o);
  return s;
};

describe("HAND_ART_STYLES", () => {
  it("has one style per action", () => {
    expect([...HAND_ART_STYLES]).toEqual(["ink", "bloom", "burst", "trail", "ripple", "glitch"]);
  });
});

describe("stepCycle", () => {
  it("starts on the first target without a morph", () => {
    const s = initialCycle(opts(), "trail");
    expect(s).toMatchObject({ a: "trail", b: "trail", mix: 0, morphing: false });
  });

  it("crossfades to a new target and ages each style from when it began", () => {
    let s = run(initialCycle(opts(), "ink"), 1000, "ink", opts());
    expect(s.ageA).toBeGreaterThanOrEqual(990);
    s = stepCycle(s, 16, "bloom", opts());
    expect(s).toMatchObject({ a: "ink", b: "bloom", morphing: true, ageB: 0 });
    s = run(s, 200, "bloom", opts());
    expect(s.mix).toBeGreaterThan(0.4);
    expect(s.mix).toBeLessThan(0.6);
    s = run(s, 220, "bloom", opts());
    expect(s).toMatchObject({ a: "bloom", b: "bloom", morphing: false, mix: 0 });
    expect(s.ageA).toBeGreaterThan(400); // bloom has been growing since its morph began
  });

  it("waits out the cooldown, then goes to the latest target (a state is never dropped)", () => {
    const o = opts({ morphMs: 100, cooldownMs: 400 });
    let s = run(initialCycle(o, "ink"), 500, "ink", o);
    s = stepCycle(s, 16, "bloom", o);
    s = run(s, 150, "bloom", o); // morph done, still inside the cooldown
    s = run(s, 100, "burst", o);
    expect(s.a).toBe("bloom");
    expect(s.morphing).toBe(false);
    s = run(s, 200, "burst", o);
    expect(s.b).toBe("burst");
  });

  it("finishes a running morph before following a newer target", () => {
    let s = run(initialCycle(opts(), "ink"), 500, "ink", opts());
    s = stepCycle(s, 16, "bloom", opts());
    s = run(s, 100, "glitch", opts());
    expect(s.b).toBe("bloom");
    s = run(s, 800, "glitch", opts());
    expect(s.a).toBe("glitch");
  });

  it("changes the noise seed for each morph", () => {
    let s = run(initialCycle(opts(), "ink"), 500, "ink", opts());
    s = stepCycle(s, 16, "bloom", opts());
    const first = s.seed;
    s = run(s, 900, "ink", opts());
    expect(s.seed).not.toBe(first);
  });

  it("holds a pinned style whatever the target", () => {
    const o = opts({ pinned: "ripple" });
    const s = run(initialCycle(opts(), "ink"), 1000, "glitch", o);
    expect(s).toMatchObject({ a: "ripple", morphing: false });
  });

  it("reduced motion: one static style at a settled age, never morphing", () => {
    const o = opts({ reducedMotion: true });
    let s = initialCycle(o, "bloom");
    for (const t of HAND_ART_STYLES) s = run(s, 300, t, o);
    expect(s).toMatchObject({ a: "ink", b: "ink", mix: 0, morphing: false, ageA: STATIC_AGE_MS, ageB: STATIC_AGE_MS });
    const pinned = stepCycle(s, 16, "ink", opts({ reducedMotion: true, pinned: "burst" }));
    expect(pinned).toMatchObject({ a: "burst", b: "burst", morphing: false });
  });
});
