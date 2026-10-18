import { describe, expect, it } from "vitest";
import { atlasLayout, atlasUv } from "./atlas";

describe("atlasLayout", () => {
  const L = atlasLayout(30, 448, 358, 8, 2400);

  it("fits every label in a grid no wider than the limit", () => {
    expect(L.rects).toHaveLength(30);
    expect(L.width).toBeLessThanOrEqual(2400);
    for (const r of L.rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(L.width);
      expect(r.y + r.h).toBeLessThanOrEqual(L.height);
    }
  });

  it("keeps padding between cells so mipmaps do not bleed into a neighbour", () => {
    const [a, b] = L.rects;
    expect(b.x - (a.x + a.w)).toBeGreaterThanOrEqual(2 * 8);
    expect(a.x).toBeGreaterThanOrEqual(8);
  });

  it("never overlaps two cells", () => {
    for (let i = 0; i < L.rects.length; i++)
      for (let j = i + 1; j < L.rects.length; j++) {
        const a = L.rects[i], b = L.rects[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
  });
});

describe("atlasUv", () => {
  it("maps a cell to uv offset + scale with the canvas flipped (v = 0 at the bottom)", () => {
    const [u0, v0, su, sv] = atlasUv({ x: 100, y: 0, w: 200, h: 100 }, 1000, 500);
    expect(u0).toBeCloseTo(0.1);
    expect(su).toBeCloseTo(0.2);
    expect(sv).toBeCloseTo(0.2);
    expect(v0).toBeCloseTo(0.8); // the top row of the canvas is the top of uv space
  });
});
