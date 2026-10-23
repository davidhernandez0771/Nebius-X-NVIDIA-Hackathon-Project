import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BLINK_EMBER, CRACK_FIREFLIES, FIREFLY_COUNTS, FIREFLY_PALETTE, LANTERNS, blinkAt, driftAt, fireflies, fireflyCount, KIND, type FireflyKind } from "./fireflyPlan";
import { walkXZ } from "./path";
import { forestLayout } from "./forestGeometry";
import { inCrack } from "./forestPlan";
import { ROBOT_TIERS } from "./forestRobots";
import { FOREST } from "./layout";

const hue = (hex: string) => {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  return hsl.h * 360;
};

describe("the forest's fireflies", () => {
  it("come in many colours, led by warm gold with cool accents, none of them green (the brand rule: no hue near 70-100°)", () => {
    const names = FIREFLY_PALETTE.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["teal", "amber", "gold", "violet", "coral", "ice"]));
    for (const c of FIREFLY_PALETTE) {
      const h = hue(c.hex);
      expect(h < 60 || h > 110, `${c.name} ${c.hex} hue ${h.toFixed(0)}`).toBe(true);
    }
    const warm = FIREFLY_PALETTE.filter((c) => c.warm).reduce((s, c) => s + c.weight, 0);
    const all = FIREFLY_PALETTE.reduce((s, c) => s + c.weight, 0);
    expect(warm / all).toBeGreaterThan(0.45);
    expect(warm / all).toBeLessThan(0.7);
  });

  it("keep their colours subtle: pale tints, none fully saturated", () => {
    for (const c of FIREFLY_PALETTE) {
      // In the hex's own (sRGB) values, as a designer reads them.
      const [r, g, b] = [1, 3, 5].map((k) => parseInt(c.hex.slice(k, k + 2), 16) / 255);
      expect(Math.max(r, g, b) - Math.min(r, g, b), c.name).toBeLessThan(0.62);
    }
  });

  it("are fewer and larger than dust: 420 on ultra, 300 on high, 120 on low and 90 on phones", () => {
    expect(FIREFLY_COUNTS).toEqual({ ultra: 420, high: 300, low: 120, phone: 90 });
    expect(fireflyCount("ultra", false)).toBe(420);
    expect(fireflyCount("low", true)).toBe(90);
    expect(fireflyCount("high", true)).toBe(90);
  });

  const layout = forestLayout();
  const f = fireflies(300, layout, ROBOT_TIERS.high.ids);
  const of = (k: FireflyKind) => [...Array(f.count).keys()].filter((i) => f.kind[i] === KIND[k]);

  it("are mostly drifting along the walk, with some round the robots, some waiting at the crack, a few large ones near the camera and the lanterns", () => {
    expect(f.count).toBe(300);
    expect(of("drift").length).toBeGreaterThan(120);
    expect(of("robot").length).toBeGreaterThanOrEqual(ROBOT_TIERS.high.ids.length * 4);
    expect(of("crack").length).toBeGreaterThan(25);
    expect(of("bokeh").length).toBeGreaterThan(3);
    expect(of("bokeh").length).toBeLessThan(15);
    expect(of("lantern").length).toBe(LANTERNS);
    expect(of("drift").length + of("robot").length + of("crack").length + of("bokeh").length + of("lantern").length).toBe(300);
  });

  it("puts the lanterns (the ones that light the forest) low over the walk, where their light falls on what the camera sees", () => {
    const walk = walkXZ();
    for (const i of of("lantern")) {
      const [x, y, z] = [f.position[i * 3], f.position[i * 3 + 1], f.position[i * 3 + 2]];
      expect(Math.min(...walk.map(([a, b]) => Math.hypot(a - x, b - z)))).toBeLessThan(4.5);
      expect(y).toBeGreaterThan(FOREST.floor + 0.5);
      expect(y).toBeLessThan(FOREST.floor + 2.4);
    }
  });

  it("gathers the robot ones round the fallen robots shown on the tier", () => {
    const spots = layout.robots.filter((s) => ROBOT_TIERS.high.ids.includes(s.id));
    const seen = new Set<string>();
    for (const i of of("robot")) {
      const [cx, cy, cz] = [f.center[i * 3], f.center[i * 3 + 1], f.center[i * 3 + 2]];
      const s = spots.find((r) => Math.hypot(r.x - cx, r.z - cz) < 1e-3);
      expect(s).toBeDefined();
      seen.add(s!.id);
      expect(cy).toBeCloseTo(FOREST.floor, 4);
    }
    expect(seen.size).toBe(spots.length);
  });

  it("puts the crack ones round the crack, and the rest over the forest floor, out of the crack", () => {
    for (const i of of("crack")) expect(inCrack(f.position[i * 3], f.position[i * 3 + 2], -3)).toBe(true);
    for (const i of of("drift")) {
      expect(f.position[i * 3 + 1]).toBeGreaterThan(FOREST.floor);
      expect(f.position[i * 3 + 1]).toBeLessThan(FOREST.floor + 9);
    }
  });

  it("gives each its own colour from the palette, its own blink rhythm and phase", () => {
    const palette = FIREFLY_PALETTE.map((c) => new THREE.Color(c.hex));
    const rhythms = new Set<number>();
    for (let i = 0; i < f.count; i++) {
      const c = new THREE.Color(f.color[i * 3], f.color[i * 3 + 1], f.color[i * 3 + 2]);
      expect(palette.some((p) => Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b) < 1e-5)).toBe(true);
      rhythms.add(Math.round(f.rand[i * 4] * 1000));
    }
    expect(rhythms.size).toBeGreaterThan(200);
  });

  it("wander like insects: slow loops plus a small quick jitter, never far from home, and still when time stops", () => {
    const r = [0.3, 0.7, 0.2, 0.5] as const;
    let far = 0, step = 0;
    let prev = driftAt(r, 0);
    for (let t = 0; t <= 120; t += 1 / 30) {
      const p = driftAt(r, t);
      far = Math.max(far, Math.hypot(p[0], p[1], p[2]));
      step = Math.max(step, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
      prev = p;
    }
    expect(far).toBeLessThan(3.6);
    expect(far).toBeGreaterThan(1);
    // Smooth from frame to frame (no teleporting), at a firefly's pace.
    expect(step).toBeLessThan(0.05);
    expect(driftAt(r, 5)).toEqual(driftAt(r, 5));
  });

  it("blink like fireflies: a quick flash, a slower fade, and a dim ember between flashes", () => {
    const r = [0.4, 0.1, 0.6, 0.5] as const;
    let bright = 0, n = 0, lo = Infinity, hi = 0;
    for (let t = 0; t < 60; t += 0.02, n++) {
      const b = blinkAt(r, t);
      lo = Math.min(lo, b);
      hi = Math.max(hi, b);
      if (b > 0.5) bright++;
    }
    expect(lo).toBeGreaterThanOrEqual(BLINK_EMBER - 1e-6);
    expect(lo).toBeLessThan(BLINK_EMBER + 0.02);
    expect(hi).toBeGreaterThan(0.95);
    expect(bright / n).toBeGreaterThan(0.06);
    expect(bright / n).toBeLessThan(0.35);
  });

  it("keeps the fall's own fireflies as many as they always were (the fall down the crack is unchanged)", () => {
    expect(CRACK_FIREFLIES).toEqual({ ultra: 180, high: 120, low: 36, phone: 24 });
    const g = fireflies(300 + 120, layout, ROBOT_TIERS.high.ids, 120);
    expect([...Array(g.count).keys()].filter((i) => g.kind[i] === KIND.crack).length).toBe(120);
  });

  it("is the same every visit", () => {
    const g = fireflies(300, layout, ROBOT_TIERS.high.ids);
    expect(g.position).toEqual(f.position);
    expect(g.color).toEqual(f.color);
  });
});
