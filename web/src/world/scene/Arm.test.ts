import { describe, expect, it } from "vitest";
import { HELIX } from "./layout";
import { REACH } from "./Arm";

describe("the arm in the middle", () => {
  it("reaches toward the cartridges without passing through them", () => {
    const inner = Math.min(...HELIX.map((s) => Math.hypot(s.position[0], s.position[2])));
    // The cartridges are 0.34 deep: the hand stops short of the innermost one's back.
    expect(REACH).toBeGreaterThan(1.2);
    expect(REACH + 0.3).toBeLessThan(inner - 0.17);
  });
});
