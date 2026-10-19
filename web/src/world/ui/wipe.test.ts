import { describe, expect, it } from "vitest";
import { band, BAND_VH, bandClip, BOTTOM_MID, breaksLength, EDGE_POINTS, edgeLine, LINE_VH, edgePoints, edgeProgress, edgeStart, MARGIN, PLAN, sectionShown, SLANT, SPAN, tear, TOP_MID } from "./wipe";

const N = PLAN.sections;
const sweep = (step = 0.01) => Array.from({ length: Math.round((breaksLength() + 1) / step) + 1 }, (_, i) => -0.5 + i * step);

describe("the breaks' plan", () => {
  it("is the hero, then a wipe and a dwell per section, then the wipe that hands back the 3D", () => {
    expect(breaksLength()).toBe(PLAN.hero + N * (PLAN.wipe + PLAN.dwell) + PLAN.wipe);
    expect(breaksLength()).toBe(8);
    expect(edgeStart(0)).toBe(PLAN.hero);
    expect(edgeStart(N) + PLAN.wipe).toBe(breaksLength());
    expect(sectionShown(0)).toBe(PLAN.hero + PLAN.wipe);
    expect(band(sectionShown(1), 1).full).toBe(true);
  });

  it("moves an edge with the scroll, clamped, and snaps it halfway with reduced motion", () => {
    const k = 1;
    const s0 = edgeStart(k);
    expect(edgeProgress(s0 - 0.2, k)).toBe(0);
    expect(edgeProgress(s0 + PLAN.wipe * 0.25, k)).toBeCloseTo(0.25, 10);
    expect(edgeProgress(s0 + PLAN.wipe * 2, k)).toBe(1);
    expect(edgeProgress(s0 + PLAN.wipe * 0.49, k, true)).toBe(0);
    expect(edgeProgress(s0 + PLAN.wipe * 0.5, k, true)).toBe(1);
  });
});

describe("a band", () => {
  it("is off screen before its edge and after the next one", () => {
    for (let k = 0; k < N; k++) {
      expect(band(edgeStart(k) - 0.01, k).visible).toBe(false);
      expect(band(edgeStart(k + 1) + PLAN.wipe + 0.01, k).visible).toBe(false);
    }
    expect([...Array(N).keys()].some((k) => band(PLAN.hero * 0.5, k).visible)).toBe(false);
    expect([...Array(N).keys()].some((k) => band(breaksLength() + 0.1, k).visible)).toBe(false);
  });

  it("starts with its whole top edge under the screen, tear included", () => {
    const y = band(edgeStart(0), 0).y;
    for (const [, ey] of edgePoints(TOP_MID, 0)) expect(y + ey).toBeGreaterThanOrEqual(100);
  });

  it("holds still over its dwell, covering the whole screen", () => {
    for (let k = 0; k < N; k++) {
      const s0 = edgeStart(k) + PLAN.wipe;
      const held = band(s0, k);
      expect(held.full).toBe(true);
      expect(band(s0 + PLAN.dwell * 0.5, k).y).toBe(held.y);
      expect(band(s0 + PLAN.dwell, k).y).toBe(held.y);
      expect(held.y).toBe(-SLANT - MARGIN);
      // The top edge is all above the screen and the bottom edge all below it.
      for (const [, ey] of edgePoints(TOP_MID, k)) expect(held.y + ey).toBeLessThanOrEqual(0);
      for (const [, ey] of edgePoints(BOTTOM_MID, k + 1)) expect(held.y + ey).toBeGreaterThanOrEqual(100);
    }
  });

  it("meets the next band exactly along their shared edge", () => {
    for (let k = 0; k < N - 1; k++) {
      const s = edgeStart(k + 1) + PLAN.wipe * 0.4;
      const a = band(s, k);
      const b = band(s, k + 1);
      expect(a.visible && b.visible).toBe(true);
      expect(b.y - a.y).toBeCloseTo(SPAN, 10);
      const lower = edgePoints(BOTTOM_MID, k + 1);
      const upper = edgePoints(TOP_MID, k + 1);
      lower.forEach(([x, y], i) => {
        expect(x).toBe(upper[i][0]);
        expect(a.y + y).toBeCloseTo(b.y + upper[i][1], 6);
      });
    }
  });

  it("moves continuously with the scroll, never more than one edge's travel per wipe", () => {
    const step = 0.01;
    for (let k = 0; k < N; k++) {
      let prev = band(-0.5, k).y;
      for (const s of sweep(step)) {
        const y = band(s, k).y;
        expect(Math.abs(y - prev)).toBeLessThanOrEqual((SPAN / PLAN.wipe) * step + 1e-9);
        expect(y).toBeLessThanOrEqual(prev + 1e-9);
        prev = y;
      }
    }
  });

  it("shows at most two sections at once, and at most one in full", () => {
    for (const s of sweep()) {
      const states = [...Array(N).keys()].map((k) => band(s, k));
      expect(states.filter((b) => b.visible).length).toBeLessThanOrEqual(2);
      expect(states.filter((b) => b.full).length).toBeLessThanOrEqual(1);
    }
  });

  it("with reduced motion, swaps sections whole: one at a time, always in the held place", () => {
    for (const s of sweep()) {
      const states = [...Array(N).keys()].map((k) => band(s, k, true));
      const shown = states.filter((b) => b.visible);
      expect(shown.length).toBeLessThanOrEqual(1);
      for (const b of shown) {
        expect(b.y).toBe(-SLANT - MARGIN);
        expect(b.full && b.on).toBe(true);
      }
    }
    expect(band(edgeStart(2) + PLAN.wipe * 0.5, 2, true).visible).toBe(true);
    expect(band(edgeStart(2) + PLAN.wipe * 0.5, 1, true).visible).toBe(false);
  });

  it("turns its headline on once its edge is a third of the way up", () => {
    const k = 2;
    expect(band(edgeStart(k) + PLAN.wipe * 0.2, k).on).toBe(false);
    expect(band(edgeStart(k) + PLAN.wipe * 0.4, k).on).toBe(true);
    expect(band(edgeStart(k + 1) + PLAN.wipe * 0.8, k).on).toBe(false);
  });
});

describe("the torn edge", () => {
  it("tears the same way every time, a little, and differently per edge", () => {
    expect(tear(3)).toEqual(tear(3));
    expect(tear(3)).not.toEqual(tear(4));
    for (let k = 0; k <= N; k++) {
      expect(tear(k)).toHaveLength(EDGE_POINTS);
      for (const o of tear(k)) expect(Math.abs(o)).toBeLessThan(MARGIN);
    }
  });

  it("slants down to the left by SLANT across the width", () => {
    const p = edgePoints(10, 0);
    expect(p[0][0]).toBe(0);
    expect(p[p.length - 1][0]).toBe(100);
    expect(p[0][1] - tear(0)[0]).toBeCloseTo(10 + SLANT / 2, 6);
    expect(p[p.length - 1][1] - tear(0)[EDGE_POINTS - 1]).toBeCloseTo(10 - SLANT / 2, 6);
  });

  it("clips a band to its two edges, inside its box", () => {
    const clip = bandClip(1);
    expect(clip.startsWith("polygon(")).toBe(true);
    const pts = clip.slice("polygon(".length, -1).split(", ");
    expect(pts).toHaveLength(EDGE_POINTS * 2);
    for (const p of pts) {
      const [x, y] = p.split(" ");
      expect(parseFloat(x)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(x)).toBeLessThanOrEqual(100);
      expect(parseFloat(y)).toBeGreaterThanOrEqual(-MARGIN);
      expect(parseFloat(y)).toBeLessThanOrEqual(BAND_VH + MARGIN);
    }
  });

  it("draws the edge's line as SVG points", () => {
    for (const inset of [0.3, -0.3]) {
      const line = edgeLine(0, inset).split(" ");
      expect(line).toHaveLength(EDGE_POINTS);
      expect(line[0]).toMatch(/^0,[\d.]+$/);
      for (const p of line) {
        const y = parseFloat(p.split(",")[1]);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(LINE_VH);
      }
    }
  });
});
