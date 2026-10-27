import { describe, expect, it } from "vitest";
import { LOGO_SYMBOL } from "../../../sant/components/logoSymbol";
import { asciiMark, cellState, parsePath } from "./asciiMark";

describe("the loader's mark in characters (the open-corner tesseract, drawn in digits)", () => {
  const m = asciiMark();

  it("reads the logo's own paths: every part's strokes, in its order", () => {
    const parts = LOGO_SYMBOL.units.map(parsePath);
    expect(parts.length).toBe(4);
    // The frame: one open polyline of six strokes; the corner lines: five separate strokes.
    expect(parts[0].length).toBe(6);
    expect(parts[1].length).toBe(5);
    for (const p of parts) for (const s of p) expect(s.every(Number.isFinite)).toBe(true);
  });

  it("covers the mark's strokes with cells, every part of it, and nothing far off them", () => {
    expect(m.cells.length).toBeGreaterThan(250);
    expect(m.cells.length).toBeLessThan(m.cols * m.rows * 0.5);
    expect(new Set(m.cells.map((c) => c.unit))).toEqual(new Set([0, 1, 2, 3]));
    for (const c of m.cells) {
      expect(c.col).toBeGreaterThanOrEqual(0);
      expect(c.col).toBeLessThan(m.cols);
      expect(c.row).toBeGreaterThanOrEqual(0);
      expect(c.row).toBeLessThan(m.rows);
      expect(c.weight).toBeGreaterThan(0);
      expect(c.weight).toBeLessThanOrEqual(1);
    }
  });

  it("fills in the logo's lighting order: the frame first, then the corner lines, the cube, its near corner", () => {
    const span = (u: number) => {
      const o = m.cells.filter((c) => c.unit === u).map((c) => c.order);
      return [Math.min(...o), Math.max(...o)];
    };
    for (let u = 0; u < 3; u++) expect(span(u)[1]).toBeLessThanOrEqual(span(u + 1)[0] + 1e-9);
    expect(span(0)[0]).toBeGreaterThanOrEqual(0);
    expect(span(3)[1]).toBeLessThanOrEqual(1);
  });

  it("draws the inner cube in the accent, like the logo", () => {
    for (const c of m.cells) expect(c.accent).toBe(LOGO_SYMBOL.accent.includes(c.unit));
  });

  it("is in numbers: digits along the strokes, a dot or two at their edges", () => {
    for (const c of m.cells) expect(c.glyph).toMatch(/^[0-9.:]$/);
    const digits = m.cells.filter((c) => /[0-9]/.test(c.glyph)).length;
    expect(digits / m.cells.length).toBeGreaterThan(0.7);
  });

  it("lights more as the load goes: none at 0, all at 1, the writing head just behind the progress", () => {
    const lit = (p: number) => m.cells.filter((c) => cellState(c, p) !== "dark").length;
    expect(lit(0)).toBe(0);
    expect(lit(1)).toBe(m.cells.length);
    let prev = 0;
    for (let p = 0; p <= 1; p += 0.05) {
      expect(lit(p)).toBeGreaterThanOrEqual(prev);
      prev = lit(p);
    }
    const heads = m.cells.filter((c) => cellState(c, 0.5) === "head");
    expect(heads.length).toBeGreaterThan(0);
    for (const c of heads) expect(c.order).toBeLessThanOrEqual(0.5);
    // At the end nothing is still being written.
    expect(m.cells.some((c) => cellState(c, 1) === "head")).toBe(false);
  });

  it("is the same every visit", () => {
    expect(asciiMark()).toEqual(m);
  });
});
