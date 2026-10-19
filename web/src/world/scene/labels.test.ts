import { describe, expect, it } from "vitest";
import { COLS, ROWS, TILE_COUNT, labelArt, tileUv } from "./labels";
import { ROBOTS } from "./robots";

describe("label tiles", () => {
  it("cover the atlas without overlapping, row 0 at the top", () => {
    const seen = new Set<string>();
    for (let t = 0; t < TILE_COUNT; t++) {
      const r = tileUv(t);
      expect(r.su).toBeCloseTo(1 / COLS, 9);
      expect(r.sv).toBeCloseTo(1 / ROWS, 9);
      expect(r.u + r.su).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.v).toBeGreaterThanOrEqual(0);
      seen.add(`${r.u},${r.v}`);
    }
    expect(seen.size).toBe(TILE_COUNT);
    expect(tileUv(0).v).toBeCloseTo(0.5, 9);
    expect(tileUv(COLS).v).toBeCloseTo(0, 9);
    expect(() => tileUv(TILE_COUNT)).toThrow(/no label tile/);
  });

  it("print each robot's code on its own tile", () => {
    ROBOTS.forEach((r, i) => expect(labelArt(i).code).toBe(r.code));
    expect(labelArt(TILE_COUNT - 1).code).not.toBe("");
  });
});
