import { describe, expect, it } from "vitest";
import { lodLevels, packIndices, type Ranges } from "./robotLod";

describe("which detail each robot is drawn at, by its distance from the camera", () => {
  const T = { near: 5, band: 1.5 };
  it("far: coarse only; well inside: detailed only; in the band: both, dissolving into each other", () => {
    expect(lodLevels(9, T)).toEqual({ coarse: true, detail: false });
    expect(lodLevels(2, T)).toEqual({ coarse: false, detail: true });
    expect(lodLevels(4.2, T)).toEqual({ coarse: true, detail: true });
  });

  it("never draws the detailed one where a tier has none", () => {
    expect(lodLevels(0.5, { near: 0, band: 0 })).toEqual({ coarse: true, detail: false });
  });

  it("packs the chosen robots' triangles into one index list", () => {
    const ranges: Ranges = { coarse: [[0, 3], [3, 6]], detail: [[6, 15], [15, 24]] };
    const all = Uint32Array.from({ length: 24 }, (_, i) => i);
    const out = new Uint32Array(24);
    const n = packIndices(all, ranges, [{ coarse: true, detail: false }, { coarse: true, detail: true }], out);
    expect(n).toBe(3 + 3 + 9);
    expect([...out.slice(0, n)]).toEqual([0, 1, 2, 3, 4, 5, ...Array.from({ length: 9 }, (_, i) => 15 + i)]);
  });
});
