import { describe, expect, it } from "vitest";
import { obbOverlap } from "./obb";
import { Matrix4 } from "three";
import { BOB, CLEARANCE, cartridgeObb, cartridgeObbFromMatrix, composeCartridgeMatrix, layoutSpiral, MAIN_SLOTS, pileOffset, RADIUS, STEP_A, type SpiralItem } from "./spiral";

const { items, pileTop } = layoutSpiral();

/** Every cartridge's box with the robots slid out by `outs` (one value per main slot) and the pile parted around them. */
function boxes(outs: number[]) {
  return items.map((it: SpiralItem) => cartridgeObb({ ...it, pivotY: it.pivotY + pileOffset(it.k, outs) }, it.ri >= 0 ? outs[it.ri] : 0));
}
function hitsAt(outs: number[], tag: string) {
  const b = boxes(outs), hits: string[] = [];
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (obbOverlap(b[i], b[j], BOB)) hits.push(`${tag} ${i}-${j}`);
  return hits;
}
const none = () => MAIN_SLOTS.map(() => 0);

describe("layoutSpiral", () => {
  it("is the same spiral on every load", () => {
    expect(layoutSpiral()).toEqual(layoutSpiral());
  });

  it("stacks 30 cartridges with the six robots in their slots", () => {
    expect(items).toHaveLength(30);
    MAIN_SLOTS.forEach((slot, ri) => expect(items[slot].ri).toBe(ri));
    expect(items.filter((it) => it.ri >= 0)).toHaveLength(MAIN_SLOTS.length);
  });

  it("climbs: every pivot sits above the one before it", () => {
    for (let k = 1; k < items.length; k++) expect(items[k].pivotY).toBeGreaterThan(items[k - 1].pivotY);
    expect(pileTop).toBe(items[items.length - 1].pivotY);
  });

  it("never lets two cartridges touch, with air left for both to bob", () => {
    expect(CLEARANCE).toBeGreaterThan(2 * BOB);
    const hits: string[] = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        if (obbOverlap(cartridgeObb(items[i]), cartridgeObb(items[j]), CLEARANCE)) hits.push(`${i}-${j}`);
    expect(hits).toEqual([]);
  });

  it("leaves the pile alone when nothing is picked", () => {
    for (const it of items) expect(pileOffset(it.k, none())).toBe(0);
  });

  it("parts the pile around a picked robot: above lifts, below drops", () => {
    const outs = none();
    outs[2] = 1; // slot 13
    expect(pileOffset(14, outs)).toBeGreaterThan(0);
    expect(pileOffset(12, outs)).toBeLessThan(0);
    expect(pileOffset(13, outs)).toBe(0);
  });

  it("slides a picked robot out without passing through its neighbours", () => {
    const hits: string[] = [];
    MAIN_SLOTS.forEach((_, ri) => {
      for (let out = 0.05; out <= 1.0001; out += 0.05) {
        const outs = none();
        outs[ri] = out;
        hits.push(...hitsAt(outs, `robot ${ri} @${out.toFixed(2)}:`));
      }
    });
    expect(hits).toEqual([]);
  });

  it("switches from one robot to another without a collision on the way", () => {
    const hits: string[] = [];
    MAIN_SLOTS.forEach((_, a) =>
      MAIN_SLOTS.forEach((_, b) => {
        if (a === b) return;
        for (let t = 0; t <= 1.0001; t += 0.1) {
          const outs = none();
          outs[a] = 1 - t;
          outs[b] = t;
          hits.push(...hitsAt(outs, `${a}->${b} @${t.toFixed(1)}:`));
        }
      }),
    );
    expect(hits).toEqual([]);
  });

  it("is messy like the references: tilts, reach, scale and steps all vary widely", () => {
    const sd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
    expect(sd(items.map((it) => it.base.x))).toBeGreaterThan(0.22);
    expect(sd(items.map((it) => it.base.z))).toBeGreaterThan(0.18);
    expect(sd(items.map((it) => it.base.y))).toBeGreaterThan(0.2);
    expect(sd(items.map((it) => it.base.rad))).toBeGreaterThan(0.38);
    expect(sd(items.map((it) => it.base.scale))).toBeGreaterThan(0.05);
    const gaps = items.slice(1).map((it, k) => it.pivotY - items[k].pivotY);
    expect(sd(gaps)).toBeGreaterThan(0.1);
  });

  it("lets a few cartridges stick out much further than the rest", () => {
    const far = items.filter((it) => it.base.rad >= RADIUS + 0.9);
    expect(far.length).toBeGreaterThanOrEqual(4);
    expect(far.length).toBeLessThanOrEqual(8);
    expect(far.every((it) => it.ri < 0)).toBe(true); // the six robots stay pickable where you expect them
  });

  it("still reads as a spiral: each cartridge stays near its turn of the helix", () => {
    for (const it of items) expect(Math.abs(it.pivotRot - it.k * STEP_A)).toBeLessThanOrEqual(0.35);
  });

  it("stays controlled: a compact pile, not a tower of air", () => {
    const meanGap = pileTop / items.length;
    expect(meanGap).toBeLessThan(0.9);
  });
});

describe("composeCartridgeMatrix", () => {
  it("puts each cartridge exactly where its collision box is, slid out and parted or not", () => {
    const m = new Matrix4();
    for (const it of items)
      for (const [out, dy] of [[0, 0], [0.5, 0.4], [1, -0.7]]) {
        composeCartridgeMatrix(m, it, out, 0, dy);
        const fromMatrix = cartridgeObbFromMatrix(m, it);
        const reference = cartridgeObb({ ...it, pivotY: it.pivotY + dy }, out);
        expect(fromMatrix.center.distanceTo(reference.center)).toBeLessThan(1e-9);
        expect(fromMatrix.half).toEqual(reference.half);
      }
  });

  it("scales the box with the cartridge", () => {
    const big = items.reduce((a, b) => (b.base.scale > a.base.scale ? b : a));
    expect(cartridgeObb(big).half[0]).toBeCloseTo(1.15 * big.base.scale);
  });
});
