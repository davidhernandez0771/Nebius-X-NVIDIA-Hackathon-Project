import { describe, expect, it } from "vitest";
import { FrameMeter, fieldSize, renderSize } from "./quality";

describe("renderSize", () => {
  it("caps the pixel ratio", () => {
    expect(renderSize(400, 300, 3, { maxDpr: 1.5, maxPixels: 1e9 })).toEqual({ width: 600, height: 450, pixelRatio: 1.5 });
    expect(renderSize(400, 300, 1, { maxDpr: 1.5, maxPixels: 1e9 })).toEqual({ width: 400, height: 300, pixelRatio: 1 });
  });

  it("caps the total pixel count, keeping the aspect", () => {
    const r = renderSize(2000, 1500, 2, { maxDpr: 2, maxPixels: 640 * 480 });
    expect(r.width * r.height).toBeLessThanOrEqual(640 * 480);
    expect(r.width / r.height).toBeCloseTo(4 / 3, 2);
  });

  it("never returns zero", () => {
    expect(renderSize(0, 0, 1, { maxDpr: 1.5, maxPixels: 1e6 })).toEqual({ width: 1, height: 1, pixelRatio: 1 });
  });
});

describe("fieldSize", () => {
  it("is a fraction of the render size, capped in width", () => {
    expect(fieldSize(800, 600, { scale: 0.5, maxWidth: 1000 })).toEqual({ width: 400, height: 300 });
    expect(fieldSize(1600, 1200, { scale: 0.5, maxWidth: 480 })).toEqual({ width: 480, height: 360 });
  });
});

describe("FrameMeter", () => {
  it("reports the mean and 95th percentile over a rolling window", () => {
    const m = new FrameMeter(10);
    expect(m.stats()).toEqual({ meanMs: 0, p95Ms: 0, count: 0 });
    for (let i = 1; i <= 20; i++) m.add(i);
    const s = m.stats();
    expect(s.count).toBe(10);
    expect(s.meanMs).toBeCloseTo(15.5); // 11..20
    expect(s.p95Ms).toBe(20);
  });
});
