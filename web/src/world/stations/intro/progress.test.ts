import { describe, expect, it, vi } from "vitest";
import { STEPS, cartridgeRows, createLoad, litRows } from "./progress";

describe("the loader's progress", () => {
  it("weighs real steps to 1 and never goes back", () => {
    expect(Object.values(STEPS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    const l = createLoad();
    const fn = vi.fn();
    l.subscribe(fn);
    l.set("canvas", 1);
    expect(l.value()).toBeCloseTo(STEPS.canvas, 9);
    l.set("canvas", 0.2);
    expect(l.value()).toBeCloseTo(STEPS.canvas, 9);
    l.set("assets", 0.5);
    l.set("fonts", 1);
    l.set("build", 1);
    l.set("compile", 1);
    l.set("assets", 1);
    expect(l.value()).toBeCloseTo(1, 9);
    expect(fn).toHaveBeenCalledTimes(6);
  });
});

describe("the slash cartridge", () => {
  it("draws a body of slashes with two reel holes and a label band", () => {
    const rows = cartridgeRows();
    expect(rows).toHaveLength(13);
    expect(rows.every((r) => r.length === 26)).toBe(true);
    const all = rows.join("");
    expect(all).toMatch(/\//);
    expect(all).toMatch(/=/);
    // The reels: a gap in the middle of a slash row.
    expect(rows[6]).toMatch(/\/ +\//);
    expect(litRows(0.5, 13)).toBe(7);
    expect(litRows(2, 13)).toBe(13);
  });
});
