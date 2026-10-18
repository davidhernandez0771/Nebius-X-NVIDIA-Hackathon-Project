import { describe, expect, it } from "vitest";
import { jointRange, pct } from "./fmt";

const j = (type: string, lower: number, upper: number) =>
  ({ type, limits: { lower, upper, effort: 1, velocity: 1 } }) as Parameters<typeof jointRange>[0];

describe("jointRange", () => {
  it("writes revolute ranges in degrees, symmetric ones as ±", () => {
    expect(jointRange(j("revolute", -0.785398, 0.785398))).toBe("±45°");
    expect(jointRange(j("revolute", -1.396, 3.491))).toBe("−80° to 200°");
  });

  it("writes prismatic ranges in millimetres", () => {
    expect(jointRange(j("prismatic", 0, 0.04))).toBe("0–40 mm");
    expect(jointRange(j("prismatic", -0.0088, 0.0528))).toBe("−9 to 53 mm");
  });

  it("names the joints without a range", () => {
    expect(jointRange({ type: "fixed", limits: null } as never)).toBe("fixed");
    expect(jointRange({ type: "continuous", limits: null } as never)).toBe("continuous");
    expect(jointRange({ type: "revolute", limits: null } as never)).toBe("no limits");
  });
});

describe("pct", () => {
  it("rounds a share to a whole percent", () => {
    expect(pct(0.513)).toBe("51%");
    expect(pct(1)).toBe("100%");
  });
});
