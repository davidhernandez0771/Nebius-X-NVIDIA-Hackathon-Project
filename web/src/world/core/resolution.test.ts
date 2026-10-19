import { describe, expect, it } from "vitest";
import { TIERS } from "./quality";
import { PIXEL_BUDGET, SCALE, createScaler, targetDpr } from "./resolution";

describe("targetDpr", () => {
  it("keeps the tier cap and the device ratio on a 1080p screen", () => {
    expect(targetDpr(TIERS.high, 1920, 1080, 1)).toBe(1);
    expect(targetDpr(TIERS.high, 1280, 720, 1.5)).toBe(1.5);
    expect(targetDpr(TIERS.low, 1280, 720, 2)).toBe(1);
  });

  it("holds a big panel to the tier's pixel budget", () => {
    // A 2560x1600 laptop panel at 150% scaling: 1707x1067 CSS px at ratio 1.5.
    const d = targetDpr(TIERS.ultra, 1707, 1067, 1.5);
    expect(1707 * 1067 * d * d).toBeLessThanOrEqual(PIXEL_BUDGET.ultra * 1.01);
    const h = targetDpr(TIERS.high, 2560, 1440, 2);
    expect(2560 * 1440 * h * h).toBeLessThanOrEqual(PIXEL_BUDGET.high * 1.01);
  });

  it("scales down with the live scale, but not below half", () => {
    expect(targetDpr(TIERS.high, 1920, 1080, 1, 0.6)).toBeCloseTo(0.6, 6);
    expect(targetDpr(TIERS.low, 4000, 3000, 1, 0.6)).toBeGreaterThanOrEqual(0.5);
  });
});

describe("the live scale", () => {
  const feed = (s: ReturnType<typeof createScaler>, ms: number) => {
    let out = null;
    for (let i = 0; i < SCALE.frames; i++) out = s.sample(ms) ?? out;
    return out;
  };

  it("renders fewer pixels when frames are slow, down to the floor, and back up with headroom", () => {
    const s = createScaler();
    expect(feed(s, 25)).toBe(0.85);
    expect(feed(s, 25)).toBe(0.7);
    expect(feed(s, 25)).toBe(SCALE.min);
    expect(feed(s, 25)).toBeNull();
    expect(feed(s, 8)).toBe(0.7);
  });

  it("stays put at a steady 60 fps and ignores idle gaps", () => {
    const s = createScaler();
    expect(feed(s, 16.7)).toBeNull();
    for (let i = 0; i < 500; i++) s.sample(900);
    expect(s.scale).toBe(1);
  });
});
