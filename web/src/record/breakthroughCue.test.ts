import { describe, expect, it } from "vitest";

import { BREAKTHROUGH_BAND, BreakthroughCue } from "./breakthroughCue";

/** Feeds depths in order; returns the cue after each. */
const run = (c: BreakthroughCue, depths: (number | null)[]) => depths.map((d) => ({ ...c.update(d) }));
const last = <T,>(xs: T[]) => xs[xs.length - 1];

describe("BreakthroughCue: reach crossing the workspace plane (control depth 0.5, the cube's row)", () => {
  it("counts a crossing toward the camera as +1 (closer) and back as -1 (away)", () => {
    const c = new BreakthroughCue();
    expect(last(run(c, [0.2, 0.3, 0.45]))).toEqual({ count: 0, dir: 1 });
    expect(last(run(c, [0.56, 0.7]))).toEqual({ count: 1, dir: 1 });
    expect(last(run(c, [0.5, 0.44, 0.3]))).toEqual({ count: 2, dir: -1 });
  });

  it("doesn't flicker inside the hysteresis band around 0.5", () => {
    const c = new BreakthroughCue();
    run(c, [0.3]);
    const out = run(c, [0.49, 0.51, 0.53, 0.47, 0.5 + BREAKTHROUGH_BAND - 0.001, 0.52]);
    expect(out.every((s) => s.count === 0)).toBe(true);
    expect(last(run(c, [0.5 + BREAKTHROUGH_BAND + 0.001])).count).toBe(1);
  });

  it("reaching the min or max of reach is not an event", () => {
    const c = new BreakthroughCue();
    expect(last(run(c, [0.3, 0.1, 0, 0, 0.1, 0]))).toEqual({ count: 0, dir: 1 });
    run(c, [0.8]); // one crossing
    expect(last(run(c, [1, 1, 0.9, 1])).count).toBe(1);
  });

  it("the first side the hand is seen on is not a crossing, nor is starting inside the band", () => {
    expect(last(run(new BreakthroughCue(), [0.9])).count).toBe(0);
    expect(last(run(new BreakthroughCue(), [0.5, 0.52, 0.8])).count).toBe(0);
  });

  it("no depth (lost hand, region off) changes nothing; the side is remembered", () => {
    const c = new BreakthroughCue();
    run(c, [0.3, null, null]);
    expect(last(run(c, [0.7])).count).toBe(1);
  });
});
