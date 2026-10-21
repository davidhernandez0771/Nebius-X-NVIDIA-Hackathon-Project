import { describe, expect, it } from "vitest";
import { clusterLod, lodLevels, packIndices, type Ranges } from "./robotLod";

/** A grid of 2n x 2n triangles over a 1 m square at y = 0, normals up, one colour. */
function sheet(n: number) {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      pos.push(i / n, 0, j / n);
      nor.push(0, 1, 0);
      col.push(0.5, 0.2, 0.1);
    }
  const idx: number[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  return { position: new Float32Array(pos), normal: new Float32Array(nor), color: new Float32Array(col), index: new Uint32Array(idx) };
}

describe("a robot's lower detail, made in code (vertices snapped to a grid)", () => {
  it("has fewer triangles the coarser the grid, and none that collapsed", () => {
    const m = sheet(40); // 3200 triangles, 2.5 cm apart
    const fine = clusterLod(m, 0.05);
    const coarse = clusterLod(m, 0.1);
    expect(fine.index.length / 3).toBeLessThan(3200);
    expect(coarse.index.length / 3).toBeLessThan(fine.index.length / 3);
    for (let t = 0; t < coarse.index.length; t += 3) {
      const [a, b, c] = [coarse.index[t], coarse.index[t + 1], coarse.index[t + 2]];
      expect(a !== b && b !== c && a !== c).toBe(true);
    }
  });

  it("keeps the shape: every vertex within half a cell of the original's bounds, normals unit, colours kept", () => {
    const m = sheet(20);
    const l = clusterLod(m, 0.1);
    for (let i = 0; i < l.position.length; i += 3) {
      expect(l.position[i]).toBeGreaterThanOrEqual(-0.05 - 1e-6);
      expect(l.position[i]).toBeLessThanOrEqual(1.05 + 1e-6);
      expect(l.position[i + 1]).toBeCloseTo(0, 6);
      expect(Math.hypot(l.normal[i], l.normal[i + 1], l.normal[i + 2])).toBeCloseTo(1, 5);
      expect([l.color[i], l.color[i + 1], l.color[i + 2]]).toEqual([0.5, 0.2, 0.1].map((v) => expect.closeTo(v, 5)));
    }
  });

  it("is the model itself at cell 0", () => {
    const m = sheet(4);
    const l = clusterLod(m, 0);
    expect(l.index).toEqual(m.index);
    expect(l.position).toEqual(m.position);
  });
});

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
