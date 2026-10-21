import { beforeEach, describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { HELIX, SPARE, slotAt } from "./layout";
import { ROBOTS } from "./robots";
import { COLOURS, FINISHES, MAX_SAVED, NAME_MAX, STORAGE_KEY, cartridgeOfSaved, cleanColour, cleanName, finishOf, parseSaved, removeSaved, resetSaved, saveCartridge, savedCartridges, savedInSlot, savedSlot, subscribeSaved, type Draft } from "./saved";

const draft = (name: string, color: string, robot: string, finish: Draft["finish"] = "matte"): Draft => ({ name, finish, color, robot });

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
  it("are six finishes, Matte first, each with its own blank colour and surface", () => {
    expect(FINISHES.map((f) => f.name)).toEqual(["Matte", "Brushed metal", "Glossy", "Translucent", "Carbon", "Ceramic"]);
    expect(new Set(FINISHES.map((f) => f.id)).size).toBe(6);
    for (const f of FINISHES) {
      expect(f.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(f.roughness).toBeGreaterThanOrEqual(0);
      expect(f.roughness).toBeLessThanOrEqual(1);
    }
    // Only the translucent one lets light through; only the metal is metal.
    expect(FINISHES.filter((f) => f.opacity < 1).map((f) => f.id)).toEqual(["clear"]);
    expect(FINISHES.filter((f) => f.metalness > 0.5).map((f) => f.id)).toEqual(["brushed"]);
    expect(finishOf("carbon").surface).toBe("weave");
    expect(finishOf("nope" as never).id).toBe("matte");
  });

  it("take any colour: the swatches, or a free #rrggbb, kept lower case", () => {
    expect(COLOURS.length).toBeGreaterThanOrEqual(6);
    for (const c of COLOURS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    // Never the sponsor's green among the swatches.
    expect(COLOURS.map((c) => c.hex)).not.toContain("#76b900");
    expect(cleanColour("#2BB39A")).toBe("#2bb39a");
    expect(cleanColour("red")).toBeNull();
    expect(cleanColour("#fff")).toBeNull();
    expect(cleanColour("#12345g")).toBeNull();
  });
});

describe("saved cartridges", () => {
  beforeEach(() => {
    localStorage.clear();
    resetSaved();
  });

  it("start empty and save into the next empty place, kept in localStorage", () => {
    expect(savedCartridges()).toEqual([]);
    const r = saveCartridge(draft("  Kitchen   arm ", "#2BB39A", "FR3", "gloss"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.place).toBe(0);
    expect(r.cartridge).toMatchObject({ name: "Kitchen arm", finish: "gloss", color: "#2bb39a", robot: "FR3" });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
    // A fresh load (the next visit) reads it back.
    resetSaved();
    expect(savedCartridges().map((c) => c.name)).toEqual(["Kitchen arm"]);
  });

  it("refuse a blank name and a full shelf", () => {
    expect(saveCartridge(draft("   ", "#e2ddd0", "S101"))).toEqual({ ok: false, reason: "name" });
    for (let i = 0; i < MAX_SAVED; i++) expect(saveCartridge(draft(`arm ${i}`, "#e2ddd0", "S101")).ok).toBe(true);
    expect(saveCartridge(draft("one more", "#e2ddd0", "S101"))).toEqual({ ok: false, reason: "full" });
  });

  it("free a place on remove, and tell subscribers about each change", () => {
    let heard = 0;
    const off = subscribeSaved(() => heard++);
    const a = saveCartridge(draft("a", "#9da2a6", "PPR"));
    const b = saveCartridge(draft("b", "#5d6268", "OPN"));
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
    const ok = { id: "k1", name: "Good", finish: "ceramic", color: "#e2ddd0", robot: "FR3", savedAt: 1 };
    const list = parseSaved(
      JSON.stringify([ok, { ...ok, id: "k2", color: "gold" }, { ...ok, id: "k3", robot: "ZZZ" }, { ...ok, id: "k4", name: "" }, { ...ok, id: "k5", finish: "velvet" }, ...Array.from({ length: 9 }, (_, i) => ({ ...ok, id: `m${i}` }))]),
    );
    expect(list[0]).toEqual(ok);
    expect(list.map((c) => c.id)).not.toContain("k5");
    expect(list).toHaveLength(MAX_SAVED);
  });

  it("read the first bench's cartridges (a named shell) as a colour on a finish", () => {
    const old = [
      { id: "o1", name: "Old", shell: "bone", robot: "FR3", savedAt: 1 },
      { id: "o2", name: "Glass", shell: "smoke", robot: "S101", savedAt: 2 },
      { id: "o3", name: "Bad", shell: "gold", robot: "S101", savedAt: 3 },
    ];
    expect(parseSaved(JSON.stringify(old))).toEqual([
      { id: "o1", name: "Old", finish: "matte", color: "#e2ddd0", robot: "FR3", savedAt: 1 },
      { id: "o2", name: "Glass", finish: "clear", color: "#5d6268", robot: "S101", savedAt: 2 },
    ]);
  });

  it("save a draft with no shell picked yet as Matte", () => {
    const r = saveCartridge({ name: "x", finish: null, color: "#323336", robot: "S101" });
    expect(r.ok && r.cartridge.finish).toBe("matte");
  });

  it("go to the machine as their robot's cartridge, from their own place", () => {
    const r = saveCartridge(draft("Desk arm", "#323336", "S101"));
    if (!r.ok) throw new Error("save failed");
    expect(cartridgeOfSaved(r.cartridge, r.place)).toEqual({ id: `mine-${r.cartridge.id}`, label: "Desk arm", route: "/pm/record", slot: HELIX.length });
    expect(ROBOTS.some((x) => x.code === r.cartridge.robot)).toBe(true);
  });
});

describe("saved cartridges on the spiral", () => {
  beforeEach(() => {
    localStorage.clear();
    resetSaved();
  });

  it("stand as the instances after the robots, each in its own empty place", async () => {
    const { N_INSTANCES, N_ITEMS, ROBOT_SLOTS, SAVED0, instanceSlot } = await import("./spiral");
    const { instanceInSlot, instanceLabel, slotLook } = await import("./Helix");
    const { SAVED_TILE0 } = await import("./labels");
    expect(SAVED0).toBe(N_ITEMS + ROBOT_SLOTS.length);
    expect(N_INSTANCES).toBe(SAVED0 + MAX_SAVED);
    expect(instanceSlot(N_ITEMS)).toBe(ROBOT_SLOTS[0]);
    expect(instanceSlot(SAVED0 + 2)).toBe(savedSlot(2));
    // Empty until one is saved.
    expect(instanceInSlot(savedSlot(0))).toBe(-1);
    saveCartridge(draft("Shed arm", "#2bb39a", "OPN"));
    expect(instanceInSlot(savedSlot(0))).toBe(SAVED0);
    expect(instanceLabel(SAVED0)).toBe("Shed arm");
    const look = slotLook(savedSlot(0));
    expect(look.tile).toBe(SAVED_TILE0);
    // The saved colour, teal: more green than red.
    expect(look.shell.g).toBeGreaterThan(look.shell.r);
  });

  it("give the machine the right cartridge for any slot, and say so when a place is empty", async () => {
    const { cartridgeInSlot } = await import("./saved");
    const { cartridgeAt } = await import("./robots");
    expect(cartridgeInSlot(0)).toEqual(cartridgeAt(HELIX[0]));
    expect(() => cartridgeInSlot(savedSlot(0))).toThrow(/empty/);
    const r = saveCartridge(draft("Lab arm", "#9da2a6", "RZ4"));
    if (!r.ok) throw new Error("save failed");
    expect(cartridgeInSlot(savedSlot(0)).label).toBe("Lab arm");
  });

  it("fly to the machine from their own place", async () => {
    const { cartridgePose } = await import("./plugSequence");
    const at = cartridgePose(savedSlot(1), 0).position;
    expect(at.toArray().map((v) => +v.toFixed(4))).toEqual(SPARE[1].position.map((v) => +v.toFixed(4)));
  });
});
