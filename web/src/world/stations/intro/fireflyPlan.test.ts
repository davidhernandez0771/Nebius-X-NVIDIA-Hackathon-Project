import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BLINK_EMBER, CRACK_FIREFLIES, FIREFLY_COUNTS, FIREFLY_PALETTE, FLOOR_CLEAR, LANTERNS, SOLID_MARGIN, arcAngle, blinkAt, clearance, driftAt, fireflies, fireflyCount, KIND, settle, solids, solidsOf, wanderAt, type FireflyKind, type Solid } from "./fireflyPlan";
import { walkXZ } from "./path";
import { forestLayout } from "./forestGeometry";
import { inCrack, toLog } from "./forestPlan";
import { ROBOT_TIERS, robotSolid } from "./forestRobots";
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

  it("gathers the robot ones round the fallen robots shown on the tier, circling clear of them", () => {
    const spots = layout.robots.filter((s) => ROBOT_TIERS.high.ids.includes(s.id));
    const seen = new Set<string>();
    for (const i of of("robot")) {
      const [cx, cy, cz, inner] = [f.center[i * 4], f.center[i * 4 + 1], f.center[i * 4 + 2], f.center[i * 4 + 3]];
      // Its circle's middle: its robot's spot, or a little off it (off a trunk the circle would cross).
      const s = spots.reduce((a, b) => (Math.hypot(a.x - cx, a.z - cz) <= Math.hypot(b.x - cx, b.z - cz) ? a : b));
      const off = Math.hypot(s.x - cx, s.z - cz);
      expect(off).toBeLessThanOrEqual(2 + 1e-4);
      seen.add(s.id);
      expect(cy).toBeCloseTo(FOREST.floor, 4);
      // Its circle's inside clears the robot, margin and all.
      expect(inner - off).toBeGreaterThanOrEqual(robotSolid(s).radius + SOLID_MARGIN - 1e-4);
    }
    expect(seen.size).toBe(spots.length);
  });

  it("puts the crack ones round the crack, and the rest over the forest floor, out of the crack", () => {
    for (const i of of("crack")) expect(inCrack(f.position[i * 3], f.position[i * 3 + 2], -3)).toBe(true);
    for (const i of of("drift")) {
      // A tight spot between trunks makes it wander less, never stop.
      expect(f.center[i * 4 + 3]).toBeGreaterThanOrEqual(0.4);
      expect(f.center[i * 4 + 3]).toBeLessThanOrEqual(1);
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

  // Where the shader puts a firefly at time t (fireflies.ts's vertex shader, before the fall), on the CPU.
  const where = (g: typeof f, i: number, t: number) => settle(wanderAt(g, i, t), solidsOf(g, i));
  // The forest's real bodies (not the keep-out round them): each trunk at its chest radius with some flare and its
  // lean, each log round its axis, each robot's posed box at any yaw.
  const F = FOREST.floor;
  const depthIn = (p: readonly number[], ids: readonly string[]) => {
    let d = 0;
    for (const t of [...layout.trees, ...layout.far]) d = Math.max(d, t.radius * 1.15 + 0.04 * Math.max(0, p[1] - F) - Math.hypot(p[0] - t.x, p[2] - t.z));
    for (const l of layout.logs) {
      const cy = F + l.radius * (1 - 2 * l.sink);
      d = Math.max(d, l.radius - Math.hypot(toLog(l, p[0], p[2]), p[1] - cy));
    }
    for (const r of layout.robots.filter((s) => ids.includes(s.id))) {
      const { radius, height } = robotSolid(r);
      if (p[1] < F + height) d = Math.max(d, radius - Math.hypot(p[0] - r.x, p[2] - r.z));
    }
    return d;
  };

  it("never fly through a trunk, a fallen log or a robot, nor under the floor, on any tier (the user's 2026-10-27 report)", () => {
    for (const tier of ["ultra", "high", "low"] as const) {
      const ids = ROBOT_TIERS[tier].ids;
      const g = fireflies(FIREFLY_COUNTS[tier] + CRACK_FIREFLIES[tier], layout, ids, CRACK_FIREFLIES[tier]);
      let checked = 0, worst = 0, deep = 0;
      for (let i = 0; i < g.count; i++) {
        if (g.kind[i] === KIND.crack) continue;
        for (let t = 0; t < 200; t += 0.93) {
          const p = where(g, i, t);
          expect(p[1]).toBeGreaterThanOrEqual(F + FLOOR_CLEAR - 1e-6);
          const d = depthIn(p, ids);
          worst = Math.max(worst, d);
          if (d > 0) deep++;
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(10000);
      // Through every body of the forest (not only the solids each carries): never into one.
      expect(deep, tier).toBe(0);
      expect(worst, tier).toBe(0);
    }
  });

  it("glide round the trunks rather than jump across them: no firefly moves more than an insect's step in a frame", () => {
    for (const tier of ["high", "low"] as const) {
      const ids = ROBOT_TIERS[tier].ids;
      const g = fireflies(FIREFLY_COUNTS[tier] + CRACK_FIREFLIES[tier], layout, ids, CRACK_FIREFLIES[tier]);
      let step = 0;
      for (let i = 0; i < g.count; i++) {
        if (g.kind[i] === KIND.crack) continue;
        let prev = where(g, i, 0);
        for (let t = 1 / 30; t < 45; t += 1 / 30) {
          const p = where(g, i, t);
          step = Math.max(step, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
          prev = p;
        }
      }
      // The free drift's own quick jitter is about 0.05 m a frame; a jump across a trunk would be metres.
      expect(step, tier).toBeLessThan(0.08);
    }
  });

  it("swing along the clear stretch of their circle where a trunk crosses it, and go round where none does", () => {
    const robots = of("robot");
    for (const i of robots) {
      // A real swing at least (a clear stretch of a few metres), never parked.
      const half = f.arc[i * 2 + 1];
      expect(half).toBeGreaterThan(0.5);
      const a = [0, 7, 19, 33].map((t) => arcAngle(f.arc[i * 2], half, f.rand[i * 4 + 1] * Math.PI * 2, 0.3, t));
      if (half < 3.14) for (const v of a) expect(Math.abs(v - f.arc[i * 2])).toBeLessThanOrEqual(half + 1e-6);
    }
    expect(robots.length).toBeGreaterThan(0);
  });

  it("knows the forest's solids: every trunk, the fallen logs end to end, and the robots shown", () => {
    const ids = ROBOT_TIERS.high.ids;
    const all = solids(layout, ids);
    expect(all.length).toBeGreaterThan(layout.trees.length + layout.far.length + layout.logs.length * 2);
    for (const t of layout.trees) expect(all.some((s) => s.x === t.x && s.z === t.z && s.r > t.radius + SOLID_MARGIN)).toBe(true);
    for (const l of layout.logs)
      for (const u of [-0.5, 0, 0.5]) {
        const x = l.x + Math.cos(l.yaw) * l.length * u, z = l.z + Math.sin(l.yaw) * l.length * u;
        expect(all.some((s) => Math.hypot(s.x - x, s.z - z) < s.r - SOLID_MARGIN)).toBe(true);
      }
    for (const r of layout.robots.filter((s) => ids.includes(s.id))) expect(all.some((s) => s.x === r.x && s.z === r.z && s.top > FOREST.floor + 0.3)).toBe(true);
  });

  it("draw a smaller halo close to a surface, so its glow doesn't cut into the bark", () => {
    const tree: Solid = { x: 0, z: 0, r: 1 + SOLID_MARGIN, top: FOREST.floor + 100 };
    expect(clearance([1.1, FOREST.floor + 3, 0], [tree])).toBeCloseTo(0.1, 5);
    expect(clearance([5, FOREST.floor + 0.6, 0], [tree])).toBeCloseTo(0.6, 5);
    // Out of the solid it is pushed to its keep-out edge, a margin clear of the bark.
    const p = settle([0.5, FOREST.floor + 3, 0], [tree]);
    expect(Math.hypot(p[0], p[2])).toBeCloseTo(1 + SOLID_MARGIN, 4);
  });

  it("is the same every visit", () => {
    const g = fireflies(300, layout, ROBOT_TIERS.high.ids);
    expect(g.position).toEqual(f.position);
    expect(g.color).toEqual(f.color);
  });
});
