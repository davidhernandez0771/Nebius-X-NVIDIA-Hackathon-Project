import { describe, expect, it } from "vitest";
import { Box3, Vector3 } from "three";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { CARTRIDGE_HALF, libraryMatrix, slotMatrix } from "./cartridge";
import { LIBRARY } from "./layout";

const half = () => new Vector3(...CARTRIDGE_HALF);
/** A library cartridge's shell as an oriented box in the world. */
const obb = (i: number, matrix = libraryMatrix) => new OBB(new Vector3(), half()).applyMatrix4(matrix(LIBRARY[i]));
const box = (i: number) => new Box3(half().negate(), half()).applyMatrix4(libraryMatrix(LIBRARY[i]));

/** Neighbouring slots on one shelf. */
function neighbours(): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < LIBRARY.length; i++) {
    const a = LIBRARY[i - 1].position;
    const b = LIBRARY[i].position;
    if (a[0] === b[0] && a[1] === b[1]) out.push([i - 1, i]);
  }
  return out;
}

describe("the library shelves", () => {
  it("stands every cartridge spine-out, inside the shelf's 1.6 m depth (|x| 20.0 to 21.6)", () => {
    LIBRARY.forEach((_, i) => {
      const b = box(i);
      expect(Math.min(Math.abs(b.min.x), Math.abs(b.max.x))).toBeGreaterThan(20.0);
      expect(Math.max(Math.abs(b.min.x), Math.abs(b.max.x))).toBeLessThan(21.6);
    });
  });

  it("leaves a gap between neighbours: no two cartridges overlap and fight over the same pixels", () => {
    const pairs = neighbours();
    expect(pairs.length).toBeGreaterThan(400);
    for (const [a, b] of pairs) expect(obb(a).intersectsOBB(obb(b))).toBe(false);
    // Face-out (layout.json's rotation as is), each 1.38 m face overlapped its neighbours, and their
    // slightly different leans interleaved in stripes that crawled with every camera move.
    expect(pairs.every(([a, b]) => obb(a, slotMatrix).intersectsOBB(obb(b, slotMatrix)))).toBe(true);
  });
});
