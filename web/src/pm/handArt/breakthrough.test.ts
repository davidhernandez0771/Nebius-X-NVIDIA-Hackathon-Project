import { describe, expect, it } from "vitest";
import {
  BREAK_COOLDOWN_MS,
  BREAK_MS,
  FLASH_MS,
  breakProgress,
  initialBreak,
  stepBreak,
  type BreakState,
} from "./breakthrough";

const run = (s: BreakState, ms: number, count: number | undefined, dir?: number, step = 16) => {
  for (let t = 0; t < ms; t += step) s = stepBreak(s, step, count, dir);
  return s;
};

describe("stepBreak: the break-through fires when the crossing count changes", () => {
  it("does nothing on the first frame, whatever the count", () => {
    const s = stepBreak(initialBreak(), 16, 7, 1);
    expect(breakProgress(s, false)).toBeNull();
  });

  it("plays for BREAK_MS in the given direction, then settles", () => {
    let s = run(initialBreak(), 100, 0);
    s = stepBreak(s, 16, 1, 1);
    expect(s.dir).toBe(1);
    expect(breakProgress(s, false)).toBe(0);
    s = run(s, BREAK_MS / 2, 1, 1);
    expect(breakProgress(s, false)).toBeGreaterThan(0.4);
    s = run(s, BREAK_MS, 1, 1);
    expect(breakProgress(s, false)).toBeNull();
  });

  it("backs out with direction -1, and falls back to 0 when the direction is missing or odd", () => {
    let s = run(initialBreak(), 100, 0);
    s = stepBreak(s, 16, 1, -1);
    expect(s.dir).toBe(-1);
    s = run(s, 1000, 1);
    s = stepBreak(s, 16, 2, undefined);
    expect(s.dir).toBe(0);
    s = run(s, 1000, 2);
    s = stepBreak(s, 16, 3, 5);
    expect(s.dir).toBe(0);
  });

  it("drops a crossing inside the cooldown, and takes one after it (restarting the effect)", () => {
    let s = run(initialBreak(), 100, 0);
    s = stepBreak(s, 16, 1, 1);
    const seed = s.seed;
    s = run(s, BREAK_COOLDOWN_MS - 50, 2, -1); // too soon: dropped, not saved for later
    expect(s.seed).toBe(seed);
    expect(s.dir).toBe(1);
    s = run(s, 100, 2, -1);
    expect(s.seed).toBe(seed);
    s = stepBreak(s, 16, 3, -1); // past the cooldown, mid-effect: restarts backing out
    expect(s.seed).toBe(seed + 1);
    expect(s).toMatchObject({ dir: -1, ageMs: 0 });
  });

  it("ignores a missing count (a page without the prop)", () => {
    let s = run(initialBreak(), 100, undefined);
    s = run(s, 100, undefined, 1);
    expect(breakProgress(s, false)).toBeNull();
  });

  it("reduced motion: the same trigger, over the shorter FLASH_MS", () => {
    let s = run(initialBreak(), 100, 0);
    s = stepBreak(s, 16, 1, 1);
    s = run(s, FLASH_MS + 20, 1);
    expect(breakProgress(s, true)).toBeNull();
    expect(breakProgress(s, false)).not.toBeNull();
  });
});
