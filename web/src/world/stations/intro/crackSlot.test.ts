import { describe, expect, it } from "vitest";
import { CRACK_SLOT, crackToWorld, isGlb } from "./crackSlot";
import { crackHalfWidth, inCrack } from "./forestPlan";
import { CRACK, FOREST, ROCK } from "./layout";

describe("the crack's GLB slot (Blender re-models the crack later)", () => {
  it("names one file and the frame a Blender model is authored in", () => {
    expect(CRACK_SLOT.url).toBe("world/models/crack.glb");
    expect(CRACK_SLOT.depth).toBeCloseTo(ROCK.top - ROCK.bottom, 9);
    expect(CRACK_SLOT.halfLength).toBe(CRACK.halfLength);
  });

  it("puts the model's origin on the crack's centre at floor level, +x along the crack", () => {
    expect(crackToWorld([0, 0, 0])).toEqual([expect.closeTo(CRACK.center[0], 9), FOREST.floor, expect.closeTo(CRACK.center[1], 9)]);
    // Halfway to a tip along the model's x, at the crack's widest: still inside the procedural lens the floor cuts.
    const [x, , z] = crackToWorld([CRACK.halfLength / 2, 0, 0]);
    expect(inCrack(x, z, 0.1)).toBe(true);
    // Across, past the half width at that point: outside.
    const [x2, , z2] = crackToWorld([CRACK.halfLength / 2, 0, crackHalfWidth(CRACK.halfLength / 2) + 0.3]);
    expect(inCrack(x2, z2)).toBe(false);
    // Down the fissure: y goes down into the rock.
    expect(crackToWorld([0, -CRACK_SLOT.depth, 0])[1]).toBeCloseTo(ROCK.bottom, 9);
  });

  it("knows a real binary glTF from the HTML page a dev server answers for a missing file", () => {
    const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]);
    expect(isGlb(glb.buffer)).toBe(true);
    expect(isGlb(new TextEncoder().encode("<!doctype html><html>").buffer)).toBe(false);
    expect(isGlb(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 0, 0, 0]).buffer)).toBe(false); // glTF 1
    expect(isGlb(new ArrayBuffer(3))).toBe(false);
  });
});
