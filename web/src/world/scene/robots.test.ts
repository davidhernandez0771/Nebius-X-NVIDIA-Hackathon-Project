import { describe, expect, it } from "vitest";
import { DEFAULT_CARTRIDGE } from "../core/layout";
import { HELIX } from "./layout";
import { ROBOTS, cartridgeAt, robotFor, slotForRobot } from "./robots";

describe("robots", () => {
  it("names every code on the spiral", () => {
    for (const s of HELIX) expect(robotFor(s.code).code).toBe(s.code);
    expect(() => robotFor("ZZZ")).toThrow(/no robot/);
  });

  it("turns a slot into the cartridge the machine gets", () => {
    expect(cartridgeAt(HELIX[0])).toEqual({ id: "so101", label: "SO-101", route: "/pm/record", slot: 0 });
    // The core's default (what plugs in when nobody chose) is that same lowest slot.
    expect(DEFAULT_CARTRIDGE).toEqual(cartridgeAt(HELIX[0]));
  });

  it("gives each robot its own slot, the ones the jobs leave free", async () => {
    const { ROBOT_SLOTS } = await import("./spiral");
    expect(ROBOTS.map((r) => slotForRobot(r.code).index).sort((a, b) => a - b)).toEqual(ROBOT_SLOTS);
    for (const r of ROBOTS) expect(cartridgeAt(slotForRobot(r.code)).id).toBe(r.id);
  });
});
