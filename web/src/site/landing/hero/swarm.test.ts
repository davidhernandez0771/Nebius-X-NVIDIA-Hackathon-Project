import { describe, expect, it } from "vitest";
import { buildSlots, parentOf, pinchCycle, population, springStep, CYCLE } from "./swarm";

describe("buildSlots", () => {
  const slots = buildSlots(128, { spacing: 20, spread: 0.55 });

  it("makes exactly the slots asked for, none on top of another", () => {
    expect(slots).toHaveLength(128);
    for (let i = 0; i < slots.length; i++)
      for (let j = i + 1; j < slots.length; j++) expect(Math.hypot(slots[i].x - slots[j].x, slots[i].y - slots[j].y)).toBeGreaterThan(10);
  });

  it("fills outward from the pinch: nearer slots come first", () => {
    for (let i = 1; i < slots.length; i++) expect(slots[i].row).toBeGreaterThanOrEqual(slots[i - 1].row);
    expect(slots[0].row).toBe(1);
  });

  it("keeps every slot inside a wedge ahead of the pinch, never around it", () => {
    for (const s of slots) {
      expect(s.x).toBeGreaterThan(0);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(s.x * 0.55 + 20);
    }
  });

  it("gives far slots more depth (blur) on average than near ones", () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(slots.slice(-20).map((s) => s.depth))).toBeGreaterThan(mean(slots.slice(0, 20).map((s) => s.depth)));
    for (const s of slots) {
      expect(s.depth).toBeGreaterThanOrEqual(0);
      expect(s.depth).toBeLessThanOrEqual(1);
    }
  });
});

describe("population and parents", () => {
  it("multiplies on every pinch up to the cap", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map((n) => population(n, 256))).toEqual([1, 4, 16, 64, 256, 256, 256]);
    expect([0, 1, 7, 8].map((n) => population(n, 128, 2))).toEqual([1, 2, 128, 128]);
  });

  it("spawns each new copy out of an existing one", () => {
    expect(parentOf(5, 4)).toBe(1);
    expect(parentOf(4, 4)).toBe(0);
    expect(parentOf(7, 4)).toBe(3);
    // Growing ×4, the newborns cycle through the copies that already exist.
    expect([4, 8, 12, 15].map((k) => parentOf(k, 4))).toEqual([0, 0, 0, 3]);
  });
});

describe("pinchCycle", () => {
  it("stays between open and shut and counts each close once", () => {
    let last = 0;
    for (let t = 0; t < CYCLE.first + 5 * CYCLE.period; t += 16) {
      const { pinch, closes } = pinchCycle(t);
      expect(pinch).toBeGreaterThanOrEqual(0);
      expect(pinch).toBeLessThanOrEqual(1);
      expect(closes).toBeGreaterThanOrEqual(last);
      expect(closes - last).toBeLessThanOrEqual(1);
      last = closes;
    }
    expect(last).toBe(5);
  });

  it("is shut at the moment it counts a close", () => {
    expect(pinchCycle(CYCLE.first - 1).closes).toBe(0);
    expect(pinchCycle(CYCLE.first).closes).toBe(1);
    expect(pinchCycle(CYCLE.first).pinch).toBeCloseTo(1, 6);
  });
});

describe("springStep", () => {
  it("settles on its target quickly and without a wide overshoot", () => {
    let s = { x: 0, y: 0, vx: 0, vy: 0 };
    let maxX = 0;
    for (let i = 0; i < 60; i++) {
      s = springStep(s, { x: 100, y: -50 }, 1 / 60);
      maxX = Math.max(maxX, s.x);
    }
    expect(s.x).toBeCloseTo(100, 0);
    expect(s.y).toBeCloseTo(-50, 0);
    expect(maxX).toBeLessThan(110);
  });

  it("stays stable on a long frame (a tab coming back)", () => {
    const s = springStep({ x: 0, y: 0, vx: 0, vy: 0 }, { x: 100, y: 0 }, 2);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(200);
  });
});
