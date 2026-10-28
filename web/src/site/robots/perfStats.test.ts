import { describe, expect, it } from "vitest";
import { FrameStats, percentile } from "./perfStats";

describe("percentile", () => {
  it("picks the nearest-rank value", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 100)).toBe(100);
  });

  it("does not reorder the caller's array", () => {
    const xs = [3, 1, 2];
    percentile(xs, 50);
    expect(xs).toEqual([3, 1, 2]);
  });

  it("is 0 for no samples", () => {
    expect(percentile([], 95)).toBe(0);
  });
});

describe("FrameStats", () => {
  it("reports fps from the mean frame interval", () => {
    const s = new FrameStats(10);
    for (let i = 0; i < 10; i++) s.push(20);
    expect(s.fps()).toBeCloseTo(50);
  });

  it("keeps only the last `cap` frames", () => {
    const s = new FrameStats(4);
    [100, 100, 10, 10, 10, 10].forEach((dt) => s.push(dt));
    expect(s.count()).toBe(4);
    expect(s.max()).toBe(10);
  });

  it("reports p95 and the worst frame, so one hitch shows up", () => {
    const s = new FrameStats(100);
    for (let i = 0; i < 99; i++) s.push(16);
    s.push(250);
    expect(s.p95()).toBe(16);
    expect(s.max()).toBe(250);
  });

  it("counts frames over a budget (hitches)", () => {
    const s = new FrameStats(10);
    [16, 16, 60, 120, 16].forEach((dt) => s.push(dt));
    expect(s.over(50)).toBe(2);
  });

  it("resets", () => {
    const s = new FrameStats(10);
    s.push(16);
    s.reset();
    expect(s.count()).toBe(0);
    expect(s.fps()).toBe(0);
  });
});
