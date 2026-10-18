import { describe, expect, it } from "vitest";
import { fitRows } from "./RoleBoard";

describe("fitRows", () => {
  it("uses full-height rows when they fit", () => {
    expect(fitRows(12, 500)).toEqual({ rowH: 32, cols: 1 });
  });

  it("shrinks the rows to fit, down to 22 px", () => {
    expect(fitRows(12, 300)).toEqual({ rowH: 25, cols: 1 });
  });

  it("flows a big robot into columns rather than scroll", () => {
    const { rowH, cols } = fitRows(60, 400);
    expect(cols).toBe(4);
    expect(Math.ceil(60 / cols) * rowH).toBeLessThanOrEqual(400);
    expect(rowH).toBeGreaterThanOrEqual(22);
  });

  it("keeps the default before the panel is measured", () => {
    expect(fitRows(12, 0)).toEqual({ rowH: 32, cols: 1 });
  });
});
