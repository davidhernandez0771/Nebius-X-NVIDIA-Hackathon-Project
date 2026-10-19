import { describe, expect, it } from "vitest";
import { TUNE, createTuner } from "./autotune";

const feed = (t: ReturnType<typeof createTuner>, ms: number, n: number = TUNE.frames) => {
  let out = null;
  for (let i = 0; i < n; i++) out = t.sample(ms) ?? out;
  return out;
};

describe("the auto-tune", () => {
  it("drops a tier after 120 slow frames, measures again, and stops on low", () => {
    const t = createTuner("ultra");
    expect(feed(t, 30, TUNE.frames - 1)).toBeNull();
    expect(t.sample(30)).toBe("high");
    expect(feed(t, 30)).toBe("low");
    expect(t.done).toBe(false);
    expect(feed(t, 30)).toBeNull();
    expect(t.done).toBe(true);
  });

  it("goes from high to ultra below 9 ms, and stays on a steady high", () => {
    const fast = createTuner("high");
    expect(feed(fast, 7)).toBe("ultra");
    expect(fast.done).toBe(true);
    const steady = createTuner("high");
    expect(feed(steady, 16.7)).toBeNull();
    expect(steady.done).toBe(true);
    expect(steady.tier).toBe("high");
  });

  it("ignores gaps between demand-rendered frames", () => {
    const t = createTuner("high");
    for (let i = 0; i < 500; i++) t.sample(1000);
    expect(t.done).toBe(false);
  });
});
