import { describe, expect, it } from "vitest";
import { hudAnchor, hudFrame } from "./hudAnchor";

describe("hudFrame", () => {
  it("sizes the frame from the shorter side, as the prototype did", () => {
    const f = hudFrame(1000, 600);
    expect(f.R).toBeCloseTo(180);
    expect(f.fw).toBeCloseTo(270);
    expect(f.fh).toBeCloseTo(171);
  });
});

describe("hudAnchor", () => {
  const W = 1200, H = 700, d = 1;

  it("leaves a lock-on that already fits exactly where it is", () => {
    expect(hudAnchor(600, 350, W, H, d)).toEqual({ cx: 600, cy: 350 });
  });

  it("pulls a frame that would run off the right edge back inside", () => {
    const { fw } = hudFrame(W, H);
    const { cx } = hudAnchor(W - 10, 350, W, H, d);
    expect(cx + fw / 2).toBeLessThanOrEqual(W);
  });

  it("keeps the title block, which sits above the frame, below the top edge", () => {
    const { fh } = hudFrame(W, H);
    const { cy } = hudAnchor(600, 5, W, H, d);
    expect(cy - fh * 0.55 - 30 * d - 11 * d).toBeGreaterThanOrEqual(0);
  });

  it("keeps the frame's bottom above the bottom edge", () => {
    const { fh } = hudFrame(W, H);
    const { cy } = hudAnchor(600, H + 200, W, H, d);
    expect(cy + fh * 0.45).toBeLessThanOrEqual(H);
  });

  it("scales the margins with the pixel ratio", () => {
    const a = hudAnchor(0, 350, W * 2, H * 2, 2);
    expect(a.cx).toBeGreaterThan(hudAnchor(0, 350, W, H, 1).cx);
  });
});
