import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";

describe("contrast (WCAG 2.x relative luminance)", () => {
  it("is 21:1 for black on white, either way round", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
  });

  it("is 1:1 for a colour on itself", () => {
    expect(contrast("#19F5C2", "#19F5C2")).toBeCloseTo(1, 5);
  });

  it("matches a published value: #767676 on white is 4.54:1", () => {
    expect(contrast("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });

  it("accepts 3-digit hex", () => {
    expect(contrast("#000", "#fff")).toBeCloseTo(21, 5);
  });
});
