import { describe, expect, it } from "vitest";
import { HELIX } from "./layout";
import { ROBOTS, cartridgeAt, robotFor, slotForRobot } from "./robots";

describe("robots", () => {
  it("names every code on the spiral", () => {
    for (const s of HELIX) expect(robotFor(s.code).code).toBe(s.code);
    expect(() => robotFor("ZZZ")).toThrow(/no robot/);
  });

  it("turns a slot into the cartridge the machine gets", () => {
    expect(cartridgeAt(HELIX[0])).toEqual({ id: "so101", label: "SO-101", route: "/pm/record", slot: 0 });
  });

  it("sends each robot's lowest slot from its button", () => {
    for (const r of ROBOTS) {
      const s = slotForRobot(r.code);
      expect(s.code).toBe(r.code);
      for (const o of HELIX) if (o.code === r.code) expect(o.position[1]).toBeGreaterThanOrEqual(s.position[1]);
    }
  });
});
