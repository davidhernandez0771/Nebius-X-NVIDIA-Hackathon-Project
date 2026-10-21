import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FIREFLY_COUNTS, FIREFLY_PALETTE, fireflies, fireflyCount, KIND, type FireflyKind } from "./fireflyPlan";
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
  it("come in many colours, mostly cool with warm accents, none of them green (the brand rule: no hue near 70-100°)", () => {
    const names = FIREFLY_PALETTE.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["teal", "amber", "gold", "violet", "coral", "ice"]));
    for (const c of FIREFLY_PALETTE) {
      const h = hue(c.hex);
      expect(h < 60 || h > 110, `${c.name} ${c.hex} hue ${h.toFixed(0)}`).toBe(true);
    }
    const warm = FIREFLY_PALETTE.filter((c) => c.warm).reduce((s, c) => s + c.weight, 0);
    const all = FIREFLY_PALETTE.reduce((s, c) => s + c.weight, 0);
    expect(warm / all).toBeGreaterThan(0.15);
    expect(warm / all).toBeLessThan(0.45);
  });

  it("number 1.5k on ultra, 1k on high, 300 on low and 200 on phones", () => {
    expect(FIREFLY_COUNTS).toEqual({ ultra: 1500, high: 1000, low: 300, phone: 200 });
    expect(fireflyCount("ultra", false)).toBe(1500);
    expect(fireflyCount("low", true)).toBe(200);
    expect(fireflyCount("high", true)).toBe(200);
  });

  const layout = forestLayout();
  const f = fireflies(1000, layout, ROBOT_TIERS.high.ids);
  const of = (k: FireflyKind) => [...Array(f.count).keys()].filter((i) => f.kind[i] === KIND[k]);

  it("are mostly drifting along the walk, with some round the robots, some waiting at the crack and a few large ones near the camera", () => {
    expect(f.count).toBe(1000);
    expect(of("drift").length).toBeGreaterThan(500);
    expect(of("robot").length).toBeGreaterThanOrEqual(ROBOT_TIERS.high.ids.length * 6);
    expect(of("crack").length).toBeGreaterThan(80);
    expect(of("bokeh").length).toBeGreaterThan(10);
    expect(of("bokeh").length).toBeLessThan(80);
    expect(of("drift").length + of("robot").length + of("crack").length + of("bokeh").length).toBe(1000);
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
    expect(rhythms.size).toBeGreaterThan(500);
  });

  it("is the same every visit", () => {
    const g = fireflies(1000, layout, ROBOT_TIERS.high.ids);
    expect(g.position).toEqual(f.position);
    expect(g.color).toEqual(f.color);
  });
});
