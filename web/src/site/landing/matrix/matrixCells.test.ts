import { describe, expect, it } from "vitest";
import { cellsFromPixels, cellSide, MIN_DOT, scrollProgress, sectionProgress, seamColumn, twinkle } from "./matrixCells";

const px = (...rgb: number[][]) => new Uint8ClampedArray(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));

describe("cellsFromPixels", () => {
  it("sizes a dot by how dark its pixel is, with a floor so the grid stays visible", () => {
    const [white, grey, black] = cellsFromPixels(px([255, 255, 255], [128, 128, 128], [0, 0, 0]), 3, 1);
    expect(white.size).toBe(MIN_DOT);
    expect(grey.size).toBeGreaterThan(white.size);
    expect(black.size).toBeGreaterThan(grey.size);
    expect(black.size).toBeLessThanOrEqual(1);
  });

  it("marks the red cube, and only the cube, as the accent", () => {
    const [cube, bin, floor] = cellsFromPixels(px([220, 30, 40], [30, 100, 230], [235, 235, 235]), 3, 1);
    expect(cube.accent).toBe(true);
    expect(bin.accent).toBe(false);
    expect(floor.accent).toBe(false);
  });
});

describe("seamColumn and cellSide", () => {
  const cols = 60;
  const rows = 40;

  it("is all photo before the scroll starts and all data after it ends", () => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        expect(cellSide(c, r, seamColumn(r, 0, 1234, cols))).toBe("photo");
        expect(cellSide(c, r, seamColumn(r, 1, 1234, cols))).toBe("data");
      }
    }
  });

  it("moves the seam steadily from right to left as the reader scrolls", () => {
    for (let r = 0; r < rows; r += 7) {
      let last = Infinity;
      for (let p = 0; p <= 1; p += 0.1) {
        const s = seamColumn(r, p, 500, cols);
        expect(s).toBeLessThan(last);
        last = s;
      }
    }
  });

  it("is ragged: rows don't all cut at the same column", () => {
    const seams = Array.from({ length: rows }, (_, r) => Math.round(seamColumn(r, 0.5, 0, cols)));
    expect(new Set(seams).size).toBeGreaterThan(3);
  });
});

describe("twinkle", () => {
  it("lights only a few cells, and only for a moment", () => {
    let lit = 0;
    for (let c = 0; c < 100; c++) for (let r = 0; r < 100; r++) if (twinkle(c, r, 1000) > 0) lit++;
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(400);
  });
});

describe("scrollProgress", () => {
  it("runs 0 → 1 while the figure crosses the screen, clamped outside", () => {
    expect(scrollProgress(900, 500, 800)).toBe(0);
    expect(scrollProgress(-900, 500, 800)).toBe(1);
    const mid = scrollProgress(150, 500, 800);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });
});

describe("sectionProgress", () => {
  it("starts when the section reaches the top fifth of the screen and ends as its bottom rises past 80%", () => {
    const vh = 800;
    const height = 2000;
    expect(sectionProgress(400, height, vh)).toBe(0);
    expect(sectionProgress(160, height, vh)).toBe(0);
    expect(sectionProgress(640 - height, height, vh)).toBe(1);
    const mid = sectionProgress(160 - (height - 480) / 2, height, vh);
    expect(mid).toBeCloseTo(0.5, 6);
  });
});
