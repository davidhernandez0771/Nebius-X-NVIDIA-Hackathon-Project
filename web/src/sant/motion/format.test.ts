import { describe, expect, it } from "vitest";
import { formatStat } from "./format";

describe("formatStat", () => {
  it("keeps a fixed number of decimals so the width never jumps", () => {
    expect(formatStat(7.5, 1)).toBe("7.5");
    expect(formatStat(42.5, 1)).toBe("42.5");
    expect(formatStat(12, 1)).toBe("12.0");
    expect(formatStat(0, 1)).toBe("0.0");
  });

  it("rounds intermediate counter values", () => {
    expect(formatStat(12.345, 1)).toBe("12.3");
    expect(formatStat(16.96, 0)).toBe("17");
  });

  it("groups thousands the same way on every machine", () => {
    expect(formatStat(149850, 0)).toBe("149,850");
  });
});
