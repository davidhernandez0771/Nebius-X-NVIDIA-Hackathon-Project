import { describe, expect, it } from "vitest";
import { FADE_S, OFF, POWER_ON_S, fadeOn, powerOn, sputter } from "./flicker";

const samples = (f: (t: number) => number, end: number, dt = 0.005) => Array.from({ length: Math.ceil(end / dt) }, (_, i) => f(i * dt));

describe("powerOn", () => {
  it("starts off, ends fully on and stays there", () => {
    expect(powerOn(-1)).toBe(OFF);
    expect(powerOn(POWER_ON_S)).toBe(1);
    expect(powerOn(POWER_ON_S + 5)).toBe(1);
  });

  it("flickers: goes dark again at least twice before it holds", () => {
    const v = samples(powerOn, POWER_ON_S);
    let drops = 0;
    for (let i = 1; i < v.length; i++) if (v[i - 1] > 0.2 && v[i] === OFF) drops++;
    expect(drops).toBeGreaterThanOrEqual(2);
    expect(v.every((x) => x >= OFF && x <= 1)).toBe(true);
  });
});

describe("sputter", () => {
  it("stays dim and repeatable while loading", () => {
    const a = samples((t) => sputter(t, 0.3), 20);
    const b = samples((t) => sputter(t, 0.3), 20);
    expect(a).toEqual(b);
    expect(Math.max(...a)).toBeLessThan(0.4);
    expect(Math.min(...a)).toBe(OFF);
  });

  it("flashes more as more of the workshop arrives", () => {
    const lit = (p: number) => samples((t) => sputter(t, p), 60).filter((x) => x > OFF).length;
    expect(lit(0)).toBeGreaterThan(0);
    expect(lit(1)).toBeGreaterThan(lit(0));
  });
});

describe("fadeOn", () => {
  it("is a plain rise with no flicker", () => {
    const v = samples(fadeOn, FADE_S + 0.1);
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1]);
    expect(fadeOn(FADE_S)).toBeCloseTo(1, 6);
  });
});
