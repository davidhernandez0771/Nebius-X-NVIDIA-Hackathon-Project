import { beforeEach, describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { HELIX, SPARE, slotAt } from "./layout";
import { ROBOTS } from "./robots";
import { MAX_SAVED, NAME_MAX, SHELLS, STORAGE_KEY, cartridgeOfSaved, cleanName, parseSaved, removeSaved, resetSaved, saveCartridge, savedCartridges, savedInSlot, savedSlot, subscribeSaved } from "./saved";

const angle = (p: readonly number[]) => Math.atan2(p[2], p[0]);

describe("the spiral's empty places", () => {
  it("fill the gaps Blender left: one after slot 10, three after slot 21", () => {
    expect(SPARE).toHaveLength(4);
    expect(SPARE.map((s) => s.after)).toEqual([10, 21, 21, 21]);
    // Each sits between its neighbours in height, and the places go up the spiral.
    for (const s of SPARE) {
      expect(s.position[1]).toBeGreaterThan(HELIX[s.after].position[1]);
      expect(s.position[1]).toBeLessThan(HELIX[s.after + 1].position[1]);
    }
    for (let i = 1; i < SPARE.length; i++) expect(SPARE[i].position[1]).toBeGreaterThan(SPARE[i - 1].position[1]);
  });

  it("are spaced like the slots around them and face out from the axis", () => {
    const step = (a: readonly number[], b: readonly number[]) => Math.abs(((angle(b) - angle(a) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    const chain = [HELIX[21].position, SPARE[1].position, SPARE[2].position, SPARE[3].position, HELIX[22].position];
    for (let i = 1; i < chain.length; i++) expect(step(chain[i - 1], chain[i])).toBeGreaterThan(0.55);
    for (const s of SPARE) {
      const face = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...s.quaternion));
      const out = new Vector3(s.position[0], 0, s.position[2]).normalize();
      expect(face.dot(out)).toBeGreaterThan(0.85);
      expect(Math.hypot(...s.quaternion)).toBeCloseTo(1, 6);
    }
  });

  it("number on after the helix slots", () => {
    expect(slotAt(3)).toBe(HELIX[3]);
    expect(slotAt(HELIX.length)).toBe(SPARE[0]);
    expect(SPARE.map((s) => s.index)).toEqual([29, 30, 31, 32]);
    expect(() => slotAt(HELIX.length + SPARE.length)).toThrow(/no slot/);
  });
});

describe("the shells", () => {
  it("are the bench's five looks, Graphite first", () => {
    expect(SHELLS.map((s) => s.name)).toEqual(["Graphite", "Smoke", "Bone", "Ash", "Signal"]);
    for (const s of SHELLS) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("saved cartridges", () => {
  beforeEach(() => {
    localStorage.clear();
    resetSaved();
  });

  it("start empty and save into the next empty place, kept in localStorage", () => {
    expect(savedCartridges()).toEqual([]);
    const r = saveCartridge({ name: "  Kitchen   arm ", shell: "signal", robot: "FR3" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.place).toBe(0);
    expect(r.cartridge).toMatchObject({ name: "Kitchen arm", shell: "signal", robot: "FR3" });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
    // A fresh load (the next visit) reads it back.
    resetSaved();
    expect(savedCartridges().map((c) => c.name)).toEqual(["Kitchen arm"]);
  });

  it("refuse a blank name and a full shelf", () => {
    expect(saveCartridge({ name: "   ", shell: "bone", robot: "S101" })).toEqual({ ok: false, reason: "name" });
    for (let i = 0; i < MAX_SAVED; i++) expect(saveCartridge({ name: `arm ${i}`, shell: "bone", robot: "S101" }).ok).toBe(true);
    expect(saveCartridge({ name: "one more", shell: "bone", robot: "S101" })).toEqual({ ok: false, reason: "full" });
  });

  it("free a place on remove, and tell subscribers about each change", () => {
    let heard = 0;
    const off = subscribeSaved(() => heard++);
    const a = saveCartridge({ name: "a", shell: "ash", robot: "PPR" });
    const b = saveCartridge({ name: "b", shell: "smoke", robot: "OPN" });
    if (!a.ok || !b.ok) throw new Error("save failed");
    removeSaved(a.cartridge.id);
    expect(savedCartridges().map((c) => c.name)).toEqual(["b"]);
    expect(savedInSlot(savedSlot(0))?.name).toBe("b");
    expect(savedInSlot(savedSlot(1))).toBeNull();
    expect(savedInSlot(3)).toBeNull();
    expect(heard).toBe(3);
    off();
  });

  it("clean names: trimmed, single spaces, no control characters, at most NAME_MAX", () => {
    expect(cleanName(" a\u0007b  c\n")).toBe("ab c");
    expect(cleanName("x".repeat(40))).toHaveLength(NAME_MAX);
  });

  it("read back only well-formed entries, and nothing from junk", () => {
    expect(parseSaved(null)).toEqual([]);
    expect(parseSaved("{not json")).toEqual([]);
    expect(parseSaved(JSON.stringify({ name: "x" }))).toEqual([]);
    const ok = { id: "k1", name: "Good", shell: "bone", robot: "FR3", savedAt: 1 };
    const list = parseSaved(JSON.stringify([ok, { ...ok, id: "k2", shell: "gold" }, { ...ok, id: "k3", robot: "ZZZ" }, { ...ok, id: "k4", name: "" }, ...Array.from({ length: 9 }, (_, i) => ({ ...ok, id: `m${i}` }))]));
    expect(list[0]).toEqual(ok);
    expect(list).toHaveLength(MAX_SAVED);
  });

  it("go to the machine as their robot's cartridge, from their own place", () => {
    const r = saveCartridge({ name: "Desk arm", shell: "graphite", robot: "S101" });
    if (!r.ok) throw new Error("save failed");
    expect(cartridgeOfSaved(r.cartridge, r.place)).toEqual({ id: `mine-${r.cartridge.id}`, label: "Desk arm", route: "/pm/record", slot: HELIX.length });
    expect(ROBOTS.some((x) => x.code === r.cartridge.robot)).toBe(true);
  });
});
