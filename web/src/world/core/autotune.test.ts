import { describe, expect, it } from "vitest";
import { TUNE, createTuner, median } from "./autotune";

const feed = (t: ReturnType<typeof createTuner>, ms: number, n: number = TUNE.frames) => {
  let out = null;
  for (let i = 0; i < n; i++) out = t.sample(ms) ?? out;
  return out;
};

describe("the auto-tune", () => {
  it("drops a tier after two slow windows in a row, measures again, and stops on low", () => {
    const t = createTuner("ultra");
    expect(feed(t, 30)).toBeNull();
    expect(feed(t, 30)).toBe("high");
    expect(feed(t, 30)).toBeNull();
    expect(feed(t, 30)).toBe("low");
    expect(t.done).toBe(false);
    expect(feed(t, 30)).toBeNull();
    expect(t.done).toBe(true);
  });

  it("does not drop for hitches: a few very slow frames in a window of fast ones", () => {
    const t = createTuner("high");
    for (let w = 0; w < 2; w++) {
      for (let i = 0; i < TUNE.frames; i++) t.sample(i % 30 === 0 ? 240 : 16.7);
    }
    expect(t.tier).toBe("high");
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

  it("takes the median", () => {
    expect(median([1, 100, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
