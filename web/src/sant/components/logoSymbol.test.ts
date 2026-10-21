// The site's mark is the user's chosen logo, the open-corner tesseract (docs/design/logo in the main
// checkout, copied to web/public/brand): the swappable symbol must draw exactly its lines.
import { describe, expect, it } from "vitest";
import MARK from "../../../public/brand/sant-mark.svg?raw";
import MONO_DARK from "../../../public/brand/sant-mark-mono-dark.svg?raw";
import MONO_LIGHT from "../../../public/brand/sant-mark-mono-light.svg?raw";
import { LOGO_SYMBOL } from "./logoSymbol";

const FILES: Record<string, string> = { "sant-mark.svg": MARK, "sant-mark-mono-light.svg": MONO_LIGHT, "sant-mark-mono-dark.svg": MONO_DARK };
const brand = (name: string) => FILES[name];

/** Every "x,y" point an SVG's lines, polylines and polygons pass through, rounded to 0.01. */
function svgPoints(svg: string): string[] {
  const out: string[] = [];
  for (const m of svg.matchAll(/points="([^"]+)"/g)) for (const p of m[1].trim().split(/\s+/)) out.push(key(...(p.split(",").map(Number) as [number, number])));
  for (const m of svg.matchAll(/x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)) out.push(key(+m[1], +m[2]), key(+m[3], +m[4]));
  return out;
}
/** Every point a path's M and L commands pass through. */
function pathPoints(d: string): string[] {
  return [...d.matchAll(/[ML]\s*([-\d.]+)[ ,]([-\d.]+)/g)].map((m) => key(+m[1], +m[2]));
}
const key = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;

describe("the logo symbol", () => {
  it("is the open-corner tesseract, point for point: the same lines as sant-mark.svg", () => {
    const svg = brand("sant-mark.svg");
    const want = new Set(svgPoints(svg));
    const got = new Set(LOGO_SYMBOL.units.flatMap(pathPoints));
    expect([...got].sort()).toEqual([...want].sort());
    expect(LOGO_SYMBOL.viewBox.split(" ").map(Number)).toHaveLength(4);
  });

  it("is drawn in strokes as wide as the file's, round-capped", () => {
    expect(brand("sant-mark.svg")).toContain(`stroke-width="${LOGO_SYMBOL.stroke}"`);
  });

  it("lights in four parts (S, A, N, T): the open frame, its corner lines, then the inner cube and its corner", () => {
    expect(LOGO_SYMBOL.units).toHaveLength(4);
    expect(LOGO_SYMBOL.accent).toEqual([2, 3]);
  });

  it("takes the accent where the file is teal (#19F5C2) and the ink where it is light", () => {
    const svg = brand("sant-mark.svg");
    const teal = new Set(
      [...svg.matchAll(/<(?:polyline|polygon|line)([^>]+)\/>/g)].filter((m) => m[1].includes('stroke="#19F5C2"')).flatMap((m) => svgPoints(`<x ${m[1]}/>`)),
    );
    const accent = new Set(LOGO_SYMBOL.accent.flatMap((i) => pathPoints(LOGO_SYMBOL.units[i])));
    expect([...accent].sort()).toEqual([...teal].sort());
  });

  it("frames the mark without its 55-unit padding, so the lockup sits tight to the wordmark", () => {
    const [x, y, w, h] = LOGO_SYMBOL.viewBox.split(" ").map(Number);
    const pts = LOGO_SYMBOL.units.flatMap(pathPoints).map((p) => p.split(",").map(Number));
    const half = LOGO_SYMBOL.stroke / 2;
    for (const [px, py] of pts) {
      expect(px - half).toBeGreaterThanOrEqual(x);
      expect(px + half).toBeLessThanOrEqual(x + w);
      expect(py - half).toBeGreaterThanOrEqual(y);
      expect(py + half).toBeLessThanOrEqual(y + h);
    }
    expect(w).toBeLessThan(90);
  });

  it("ships the mono files for light and dark grounds, the same lines in one ink", () => {
    for (const [file, ink] of [
      ["sant-mark-mono-light.svg", "#EEF1F3"],
      ["sant-mark-mono-dark.svg", "#0B0E11"],
    ] as const) {
      const svg = brand(file);
      expect(new Set(svgPoints(svg))).toEqual(new Set(svgPoints(brand("sant-mark.svg"))));
      expect([...svg.matchAll(/stroke="(#[0-9A-F]{6})"/gi)].every((m) => m[1].toUpperCase() === ink)).toBe(true);
    }
  });
});
