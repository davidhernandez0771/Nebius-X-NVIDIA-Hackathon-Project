import { describe, expect, it } from "vitest";
import { MIST_BANDS } from "./forestPlan";
import { bandAlpha, bandDepth, bandK, erf, MIST_REACH } from "./mistBands";
import { placeUniforms } from "./placeShaders";

/** The band's density integrated along the segment by brute force. */
function numeric(y0: number, y1: number, len: number, y: number, t: number): number {
  const n = 4000;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const h = y0 + ((y1 - y0) * (i + 0.5)) / n;
    s += Math.exp(-(((h - y) / t) ** 2));
  }
  return (s * len) / n;
}

describe("the mist bands, integrated along the view ray (no geometry)", () => {
  it("approximates erf closely", () => {
    for (const [x, v] of [[0, 0], [0.5, 0.5205], [1, 0.8427], [2, 0.9953], [-1, -0.8427]] as const) expect(erf(x)).toBeCloseTo(v, 3);
  });

  it("matches a brute-force integral through, along and past a band", () => {
    const cases: [number, number, number][] = [
      [1.6, 1.6, 20], // level, inside the band
      [1.6, 0, 12], // down through it to the floor
      [0.3, 9, 30], // up through it
      [6, 12, 25], // above it all
      [1.6, 1.6005, 40], // grazing, nearly level
    ];
    for (const [y0, y1, len] of cases) {
      const want = numeric(y0, y1, len, 1.7, 1.5);
      expect(Math.abs(bandDepth(y0, y1, len, 1.7, 1.5) - want)).toBeLessThan(0.01 * want + 1e-3);
    }
  });

  it("is as opaque as the plan says over MIST_REACH metres level through a band's middle", () => {
    for (const b of MIST_BANDS) {
      const a = bandAlpha(bandDepth(b.y, b.y, MIST_REACH, b.y, b.thickness), bandK(b.opacity));
      expect(a).toBeCloseTo(b.opacity, 6);
    }
  });

  it("thins to nothing well above the bands", () => {
    const b = MIST_BANDS[2];
    expect(bandAlpha(bandDepth(b.y + 4 * b.thickness, b.y + 6 * b.thickness, 30, b.y, b.thickness), bandK(b.opacity))).toBeLessThan(1e-4);
  });

  it("is off by default, so the reactor's places are untouched", () => {
    const u = placeUniforms({ k: 0.05, mistY: 0, mistK: 1, fog: "#000000", mist: "#000000" });
    expect(u.uBandK.value.toArray()).toEqual([0, 0, 0]);
  });
});
