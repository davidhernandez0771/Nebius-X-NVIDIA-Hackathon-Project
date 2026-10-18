import { describe, expect, it } from "vitest";
import { replay, wilson } from "./stats";

const pct = ([lo, hi]: [number, number]) => [Math.round(lo * 1000) / 10, Math.round(hi * 1000) / 10];

describe("wilson", () => {
  it("matches the CIs T1's stats.py printed in the T3 note", () => {
    expect(pct(wilson(3, 40))).toEqual([2.6, 19.9]);
    expect(pct(wilson(17, 40))).toEqual([28.5, 57.8]);
    expect(pct(wilson(16, 40))).toEqual([26.3, 55.4]);
    expect(pct(wilson(4, 60))).toEqual([2.6, 15.9]);
  });

  it("stays inside 0..1 at the edges", () => {
    const [lo0, hi0] = wilson(0, 40);
    expect(lo0).toBeCloseTo(0, 12);
    expect(hi0).toBeGreaterThan(0);
    const [lo1, hi1] = wilson(40, 40);
    expect(lo1).toBeLessThan(1);
    expect(hi1).toBeCloseTo(1, 12);
  });

  it("knows nothing before the first scene", () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
  });

  it("rejects counts that can't be", () => {
    expect(() => wilson(5, 4)).toThrow();
    expect(() => wilson(-1, 4)).toThrow();
  });
});

describe("replay", () => {
  it("has one frame per scene plus the empty start", () => {
    const frames = replay("0110");
    expect(frames.map((f) => [f.n, f.k])).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 2],
    ]);
  });

  it("carries the running rate and its Wilson CI", () => {
    const last = replay("0110").at(-1)!;
    expect(last.rate).toBe(0.5);
    expect([last.lo, last.hi]).toEqual(wilson(2, 4));
    expect(replay("")[0].rate).toBeNull();
  });

  it("only accepts 0 and 1", () => {
    expect(() => replay("01x")).toThrow();
  });
});
