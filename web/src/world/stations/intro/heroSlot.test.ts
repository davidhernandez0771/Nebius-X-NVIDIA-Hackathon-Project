import { describe, expect, it } from "vitest";
import { heroSlot, type Box } from "./heroSlot";

const box = ([left, top, right, bottom]: number[]): Box => ({ left, top, right, bottom });
const dist = (x: number, y: number, b: Box) => Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));

/** The hero's boxes as headless Chrome laid them out (the hero beat's headline and column, the scroll hint, the
 *  brand, the contact button, the station rail, the quality chip), at the three sizes the site is checked at. */
const LAYOUTS: { name: string; w: number; h: number; keep: Box[] }[] = [
  {
    name: "1280x720",
    w: 1280,
    h: 720,
    keep: [[77, 268, 685, 452], [791, 312, 1111, 408], [564, 652, 701, 670], [24, 22, 250, 40], [1180, 18, 1242, 36], [1132, 266, 1240, 456], [1088, 658, 1245, 698]].map(box),
  },
  {
    name: "1920x1080",
    w: 1920,
    h: 1080,
    keep: [[115, 410, 1008, 671], [1415, 492, 1735, 588], [884, 986, 1021, 1004], [24, 22, 250, 40], [1820, 18, 1882, 36], [1772, 446, 1880, 636], [1728, 1018, 1885, 1058]].map(box),
  },
  {
    name: "390x844 (phone)",
    w: 390,
    h: 844,
    keep: [[20, 93, 370, 191], [20, 689, 370, 768], [127, 801, 263, 819], [16, 74, 150, 92], [222, 70, 374, 112], [350, 306, 356, 538]].map(box),
  },
];

describe("where the hero's tesseract floats: the largest clear space, never over the type", () => {
  for (const l of LAYOUTS)
    it(`keeps it clear of every box at ${l.name}, inside the screen, and not tiny`, () => {
      const s = heroSlot({ w: l.w, h: l.h }, l.keep, { pad: 16, margin: 12, maxR: 10_000 });
      for (const b of l.keep) expect(dist(s.cx, s.cy, b), `${l.name}: ${JSON.stringify(b)}`).toBeGreaterThanOrEqual(s.r + 16 - 1e-6);
      expect(s.cx - s.r).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(s.cy - s.r).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(s.cx + s.r).toBeLessThanOrEqual(l.w - 12 + 1e-6);
      expect(s.cy + s.r).toBeLessThanOrEqual(l.h - 12 + 1e-6);
      expect(s.r).toBeGreaterThan(Math.min(l.w, l.h) * 0.12);
    });

  it("never grows past its designed size, and then sits as near the screen's centre as it can", () => {
    const s = heroSlot({ w: 1000, h: 800 }, [], { pad: 16, margin: 12, maxR: 150 });
    expect(s.r).toBe(150);
    expect(Math.hypot(s.cx - 500, s.cy - 400)).toBeLessThan(10);
  });

  it("is the same for the same layout (it only moves when the layout does)", () => {
    const l = LAYOUTS[0];
    expect(heroSlot({ w: l.w, h: l.h }, l.keep, { pad: 16, margin: 12, maxR: 300 })).toEqual(heroSlot({ w: l.w, h: l.h }, l.keep, { pad: 16, margin: 12, maxR: 300 }));
  });
});
