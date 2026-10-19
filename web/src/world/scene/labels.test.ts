import { describe, expect, it } from "vitest";
import { COLS, ROWS, TILE_COUNT, labelArt, tileUv } from "./labels";
import { ROBOTS } from "./robots";

describe("label tiles", () => {
  it("cover the atlas without overlapping, row 0 at the top", () => {
    const seen = new Set<string>();
    for (let t = 0; t < TILE_COUNT; t++) {
      const r = tileUv(t);
      expect(r.su).toBeCloseTo(1 / COLS, 9);
      expect(r.sv).toBeCloseTo(1 / ROWS, 9);
      expect(r.u + r.su).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.v).toBeGreaterThanOrEqual(0);
      seen.add(`${r.u},${r.v}`);
    }
    expect(seen.size).toBe(TILE_COUNT);
    expect(tileUv(0).v).toBeCloseTo(1 - 1 / ROWS, 9);
    expect(tileUv(COLS).v).toBeCloseTo(1 - 2 / ROWS, 9);
    expect(() => tileUv(TILE_COUNT)).toThrow(/no label tile/);
  });

  it("print each robot's code on its own tile", () => {
    ROBOTS.forEach((r, i) => expect(labelArt(i).code).toBe(r.code));
    expect(labelArt(TILE_COUNT - 1).code).not.toBe("");
  });
});

describe("job tiles", () => {
  it("print every job's title under its tag", async () => {
    const { ITEMS, tagLabel } = await import("./items");
    const { ITEM_TILE0 } = await import("./labels");
    expect(ITEM_TILE0 + ITEMS.length).toBeLessThanOrEqual(TILE_COUNT);
    ITEMS.forEach((it, i) => {
      const art = labelArt(ITEM_TILE0 + i);
      expect(art.code).toBe(it.title);
      expect(art.band).toContain(tagLabel(it.tag).toUpperCase());
    });
  });
});

describe("saved cartridge tiles", () => {
  it("print each saved cartridge in its place, and a blank where none is", async () => {
    const { ITEM_TILE0, SAVED_TILE0, draftArt } = await import("./labels");
    const { ITEMS } = await import("./items");
    const { MAX_SAVED, resetSaved, saveCartridge } = await import("./saved");
    localStorage.clear();
    resetSaved();
    // The jobs' tiles end where the saved ones begin.
    expect(SAVED_TILE0).toBe(ITEM_TILE0 + ITEMS.length);
    expect(SAVED_TILE0 + MAX_SAVED).toBeLessThanOrEqual(TILE_COUNT);
    expect(labelArt(SAVED_TILE0).code).toBe("+");
    saveCartridge({ name: "Kitchen arm", shell: "bone", robot: "PPR" });
    const art = labelArt(SAVED_TILE0);
    expect(art).toMatchObject({ code: "KITCHEN ARM", line: "AGILEX PIPER · 6-DOF · DESKTOP ARM", serial: "MINE-001" });
    expect(labelArt(SAVED_TILE0 + 1).code).toBe("+");
    // A draft with no name yet is the render's blank, with the robot chosen so far.
    expect(draftArt({ name: " ", shell: "bone", robot: "FR3" })).toMatchObject({ code: "+", line: "NAME YOUR ROBOT  ·  FRANKA FR3", serial: "MINE-NEW" });
    localStorage.clear();
    resetSaved();
  });
});

