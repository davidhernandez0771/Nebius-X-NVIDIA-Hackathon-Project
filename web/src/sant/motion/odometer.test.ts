import { describe, expect, it } from "vitest";
import { odometer, placesFor } from "./odometer";

describe("placesFor", () => {
  it("has a place for every integer digit of the larger value, then the decimals", () => {
    expect(placesFor(7.5, 42.5, 1)).toEqual([1, 0, -1]);
    expect(placesFor(0, 300, 0)).toEqual([2, 1, 0]);
    expect(placesFor(0.4, 0.9, 2)).toEqual([0, -1, -2]);
  });
});

describe("odometer", () => {
  it("rests on whole digits at a value", () => {
    expect(odometer(42.5, [1, 0, -1]).map((c) => c.pos)).toEqual([4, 2, 5]);
    expect(odometer(7.5, [1, 0, -1]).map((c) => c.pos)).toEqual([0, 7, 5]);
  });

  it("rolls the lowest place continuously", () => {
    expect(odometer(39.75, [1, 0, -1])[2].pos).toBeCloseTo(7.5);
  });

  it("carries into a higher place only while the place below passes 9", () => {
    const mid = odometer(39.75, [1, 0, -1]);
    expect(mid[1].pos).toBeCloseTo(9);
    expect(mid[0].pos).toBeCloseTo(3);
    const carry = odometer(39.95, [1, 0, -1]);
    expect(carry[2].pos).toBeCloseTo(9.5);
    expect(carry[1].pos).toBeCloseTo(9.5);
    expect(carry[0].pos).toBeCloseTo(3.5);
  });

  it("marks leading places, so they show blank instead of 0", () => {
    expect(odometer(7.5, [1, 0, -1]).map((c) => c.lead)).toEqual([true, false, false]);
    expect(odometer(42.5, [1, 0, -1]).map((c) => c.lead)).toEqual([false, false, false]);
    expect(odometer(105, [2, 1, 0]).map((c) => c.lead)).toEqual([false, false, false]);
  });

  it("is not thrown off by floating point", () => {
    expect(odometer(0.3, [0, -1]).map((c) => c.pos)).toEqual([0, 3]);
    expect(odometer(42.5 - 1e-12, [1, 0, -1]).map((c) => Math.round(c.pos * 1000) / 1000)).toEqual([4, 2, 5]);
  });
});
