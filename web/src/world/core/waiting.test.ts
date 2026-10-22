// What each station needs before its scene can stand, the order the background fetches it in, and
// when the visitor is somewhere that is still on its way.
import { describe, expect, it } from "vitest";
import { BAKED, CARTRIDGE_URL, MACHINE_URL, MACHINE_V2_URL, bakedUrl } from "../scene/assets";
import { ROBOT_TIERS, robotUrl } from "../stations/intro/forestRobots";
import { span } from "../stations/intro/storyPlan";
import SIZES from "./assetSizes.json";
import { prefetchOrder, stationFiles, waitFor } from "./waiting";

const BASE = "/";
const key = (u: string) => u.replace(/^\//, "");

// The sizes are the files' own (scripts/asset-sizes.mjs writes them); read the real files to check.
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { statSync(p: string): { size: number } };

describe("the files' sizes", () => {
  it("are the files' own, byte for byte, for every file the background fetches", () => {
    for (const tier of ["low", "high", "ultra"] as const)
      for (const u of prefetchOrder(tier)) {
        const k = key(u);
        expect(SIZES, k).toHaveProperty([k]);
        expect((SIZES as Record<string, number>)[k], k).toBe(fs.statSync(`public/${k}`).size);
      }
  });
});

describe("what each station needs", () => {
  it("the hero needs no file: the loader waits for it alone, everything else streams after", () => {
    expect(stationFiles("intro", "high")).toEqual([]);
  });

  it("the descent builds the workshop out of its baked models and the machine", () => {
    expect(stationFiles("descent", "high")).toEqual([...BAKED.map(bakedUrl), MACHINE_V2_URL]);
  });

  it("the workshop and its branches need the room, the cartridges, the machine and the wall's robots", () => {
    const room = stationFiles("workshop", "high");
    for (const u of [...BAKED.map(bakedUrl), CARTRIDGE_URL, MACHINE_URL, MACHINE_V2_URL]) expect(room).toContain(u);
    expect(room).toContain(`${BASE}world/models/robots/ur5e.glb`);
    for (const id of ["machine", "workbench", "zoom", "robots"] as const) for (const u of stationFiles(id, "high")) expect(room).toContain(u);
    // The low tier's wall leaves the extra robots out, so it doesn't wait for them.
    expect(stationFiles("workshop", "low")).not.toContain(`${BASE}world/models/robots/ur5e.glb`);
  });

  it("fetches in the order the journey reaches them: the forest's crack and robots, then the descent's, then the rest", () => {
    const order = prefetchOrder("high");
    expect(order[0]).toBe(`${BASE}world/models/crack.glb`);
    const forest = ROBOT_TIERS.high.ids.map((id) => `${BASE}${robotUrl(id)}`);
    expect(order.slice(1, 1 + forest.length)).toEqual(forest);
    expect(order.indexOf(bakedUrl("room"))).toBeGreaterThan(forest.length);
    expect(order.indexOf(MACHINE_URL)).toBeGreaterThan(order.indexOf(bakedUrl("room")));
    expect(new Set(order).size).toBe(order.length);
    // The low tier keeps the procedural crack: no model to fetch.
    expect(prefetchOrder("low")).not.toContain(`${BASE}world/models/crack.glb`);
  });
});

describe("waiting in place", () => {
  it("nothing to wait for at the hero", () => {
    expect(waitFor("intro", 0, "high", false)).toBeNull();
  });

  it("the forest's files once the camera sinks toward it (not with reduced motion, which holds the hero)", () => {
    const [sink] = span("sink");
    const w = waitFor("intro", sink + 1, "high", false);
    expect(w?.label).toBe("the forest");
    expect(w?.files[0]).toBe(`${BASE}world/models/crack.glb`);
    expect(waitFor("intro", sink + 1, "high", true)).toBeNull();
  });

  it("each later station's own files, under its own name", () => {
    expect(waitFor("descent", 0, "high", false)?.label).toBe("the descent");
    expect(waitFor("workshop", 0, "high", false)?.label).toBe("the workshop");
    expect(waitFor("machine", 0, "high", false)?.label).toBe("the machine");
    expect(waitFor("robots", 0, "high", false)?.label).toBe("the robot wall");
    expect(waitFor("workshop", 0, "high", false)?.files).toEqual(stationFiles("workshop", "high"));
  });
});
