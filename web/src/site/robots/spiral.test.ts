import { describe, expect, it } from "vitest";
import { obbOverlap } from "./obb";
import { BOB, CLEARANCE, cartridgeObb, layoutSpiral, MAIN_SLOTS, pileOffset, type SpiralItem } from "./spiral";

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

  it("stays messy: tilts, reach and steps all vary", () => {
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(spread(items.map((it) => it.base.x))).toBeGreaterThan(0.35);
    expect(spread(items.map((it) => it.base.z))).toBeGreaterThan(0.3);
    expect(spread(items.map((it) => it.base.rad))).toBeGreaterThan(0.4);
    const gaps = items.slice(1).map((it, k) => it.pivotY - items[k].pivotY);
    expect(spread(gaps)).toBeGreaterThan(0.15);
  });

  it("stays controlled: a compact pile, not a tower of air", () => {
    const meanGap = pileTop / items.length;
    expect(meanGap).toBeLessThan(0.75);
  });
});
