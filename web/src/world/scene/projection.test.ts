// site-nav (2026-10-26, the user): the machine's panel said "SO-101" while its line said "FRANKA FR3" and the hologram
// was a Franka. What the machine projects now comes from one place (projection.ts), for every cartridge: the title,
// the line under it, the caption beside the machine and the hologram's robot agree.
import { describe, expect, it } from "vitest";
import { DEFAULT_CARTRIDGE } from "../core/layout";
import { ITEMS } from "./items";
import { HELIX } from "./layout";
import { projectionOf, REPLAY } from "./projection";
import { ROBOTS, cartridgeAt, slotForRobot } from "./robots";
import { cartridgeOfSaved } from "./saved";
import { cartridgeOfItem } from "./spiral";

const every = () => [
  DEFAULT_CARTRIDGE,
  ...ROBOTS.map((r) => cartridgeAt(slotForRobot(r.code))),
  ...ITEMS.map((_, i) => cartridgeOfItem(i)),
  ...ROBOTS.map((r, i) => cartridgeOfSaved({ id: `c${i}`, name: `Mine ${i}`, finish: "matte", color: "graphite", robot: r.code, savedAt: 0 } as never, i)),
];

describe("what the machine projects", () => {
  it("is the one verified replay there is: the Franka FR3's pick-and-place (the hologram's twin)", () => {
    expect(REPLAY.code).toBe("FR3");
    expect(REPLAY.robot).toBe("Franka FR3");
    expect(cartridgeAt(HELIX[1]).robot).toBe("FR3");
  });

  it("titles the panel with the robot the hologram shows, for every cartridge", () => {
    for (const c of every()) {
      const p = projectionOf(c);
      expect(p.title).toBe("FRANKA FR3");
      expect(p.line).toMatch(/^PICK CUBE → BIN/);
      expect(p.cartridgeLine).toContain(c.label.toUpperCase());
    }
  });

  it("says the robot is the cartridge's own only when it is the Franka", () => {
    for (const c of every()) {
      const p = projectionOf(c);
      expect(p.own).toBe(c.robot === "FR3");
      if (p.own) expect(p.lede).toContain("Franka FR3");
      else {
        expect(p.lede).not.toMatch(/its robot/);
        expect(p.lede).toContain("projects the Franka FR3's");
      }
    }
  });

  it("the default (the SO-101) is honest about it", () => {
    const p = projectionOf(DEFAULT_CARTRIDGE);
    expect(DEFAULT_CARTRIDGE.robot).toBe("S101");
    expect(p.own).toBe(false);
    expect(p.lede).toBe("SO-101 plugs in. The SO-101 has no verified replay yet, so the machine projects the Franka FR3's: a real, physics-checked demo, replayed.");
    expect(p.cartridgeLine).toBe("CARTRIDGE · SO-101 · NO OWN REPLAY");
  });

  it("a job on the Franka and a robot-less job", () => {
    const grasp = cartridgeOfItem(ITEMS.findIndex((i) => i.title === "GRASP FIX"));
    expect(projectionOf(grasp).lede).toBe("GRASP FIX plugs in, and the machine projects its robot, the Franka FR3: a real, physics-checked demo, replayed.");
    const any = cartridgeOfItem(ITEMS.findIndex((i) => i.robot === "ANY"));
    expect(any.robot).toBeUndefined();
    expect(projectionOf(any).lede).toContain("names no robot");
    const fr3 = cartridgeAt(slotForRobot("FR3"));
    expect(projectionOf(fr3).lede).toBe("Franka FR3 plugs in, and the machine projects it: a real, physics-checked demo, replayed.");
  });
});
