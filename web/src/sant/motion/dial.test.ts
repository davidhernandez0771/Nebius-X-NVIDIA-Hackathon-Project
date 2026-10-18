import { describe, expect, it } from "vitest";
import { dialAngle, dialTicks } from "./dial";

describe("dialAngle", () => {
  it("maps the range onto the sweep, centred on 0", () => {
    expect(dialAngle(0, 0, 80, 240)).toBe(-120);
    expect(dialAngle(40, 0, 80, 240)).toBe(0);
    expect(dialAngle(80, 0, 80, 240)).toBe(120);
  });

  it("clamps values outside the range", () => {
    expect(dialAngle(-10, 0, 80, 240)).toBe(-120);
    expect(dialAngle(200, 0, 80, 240)).toBe(120);
  });

  it("works for ranges that cross zero", () => {
    expect(dialAngle(0, -166, 166, 300)).toBe(0);
    expect(dialAngle(166, -166, 166, 300)).toBe(150);
  });
});

describe("dialTicks", () => {
  it("puts a tick on every step and marks the majors with labels", () => {
    const ticks = dialTicks(0, 80, 10, 40, 240);
    expect(ticks.map((t) => t.value)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80]);
    expect(ticks.filter((t) => t.major).map((t) => t.value)).toEqual([0, 40, 80]);
    expect(ticks[0].angle).toBe(-120);
  });

  it("starts majors from the range's own zero when it crosses zero", () => {
    const ticks = dialTicks(-166, 166, 10, 90, 300);
    expect(ticks.filter((t) => t.major).map((t) => t.value)).toEqual([-90, 0, 90]);
    expect(ticks[0].value).toBe(-160);
    expect(ticks[ticks.length - 1].value).toBe(160);
  });
});
