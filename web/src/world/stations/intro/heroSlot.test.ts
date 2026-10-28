import { describe, expect, it } from "vitest";
import { heroSlot, type Box } from "./heroSlot";

const box = ([left, top, right, bottom]: number[]): Box => ({ left, top, right, bottom });
const dist = (x: number, y: number, b: Box) => Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));

/** The hero's boxes as headless Chrome laid them out with the tesseract as the hero (the copy stacked on the left,
 *  on phones under it): the headline and kicker, the column, the scroll hint, the brand, the contact button, the
 *  station rail, the quality chip, at the three sizes the site is checked at. */
const LAYOUTS: { name: string; w: number; h: number; keep: Box[]; big: number }[] = [
  {
    name: "1280x720",
    w: 1280,
    h: 720,
    keep: [[77, 220, 574, 373], [77, 403, 437, 500], [564, 652, 701, 670], [24, 22, 247, 40], [1184, 18, 1241, 35], [1130, 265, 1239, 455], [1088, 658, 1245, 700]].map(box),
    big: 0.3 * 720,
  },
  {
    name: "1920x1080",
    w: 1920,
    h: 1080,
    keep: [[115, 366, 862, 587], [115, 617, 475, 714], [884, 986, 1021, 1004], [24, 22, 247, 40], [1824, 18, 1881, 35], [1768, 445, 1877, 635], [1728, 1018, 1885, 1060]].map(box),
    big: 0.3 * 1080,
  },
  {
    name: "390x844 (phone)",
    w: 390,
    h: 844,
    keep: [[20, 582, 287, 673], [20, 689, 370, 768], [127, 801, 263, 819], [16, 76, 73, 93], [353, 307, 382, 537], [205, 70, 374, 112]].map(box),
    big: 0.4 * 390,
  },
];

describe("where the hero's tesseract floats: the largest clear space, never over the type", () => {
  for (const l of LAYOUTS)
    it(`keeps it clear of every box at ${l.name}, inside the screen, and large: the hero (its whole 4D reach in the circle)`, () => {
      const s = heroSlot({ w: l.w, h: l.h }, l.keep, { pad: 16, margin: 12, maxR: 10_000 });
      for (const b of l.keep) expect(dist(s.cx, s.cy, b), `${l.name}: ${JSON.stringify(b)}`).toBeGreaterThanOrEqual(s.r + 16 - 1e-6);
      expect(s.cx - s.r).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(s.cy - s.r).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(s.cx + s.r).toBeLessThanOrEqual(l.w - 12 + 1e-6);
      expect(s.cy + s.r).toBeLessThanOrEqual(l.h - 12 + 1e-6);
      expect(s.r).toBeGreaterThan(l.big);
    });

  it("never grows past its designed size, and then sits as near the screen's centre as it can", () => {
    const s = heroSlot({ w: 1000, h: 800 }, [], { pad: 16, margin: 12, maxR: 150 });
    expect(s.r).toBe(150);
    expect(Math.hypot(s.cx - 500, s.cy - 400)).toBeLessThan(10);
  });

  it("sits in the right half on desktop (the copy has the left), and above the copy on phones", () => {
    const [desk, wide, phone] = LAYOUTS.map((l) => heroSlot({ w: l.w, h: l.h }, l.keep, { pad: 16, margin: 12, maxR: 10_000 }));
    expect(desk.cx).toBeGreaterThan(1280 / 2);
    expect(wide.cx).toBeGreaterThan(1920 / 2);
    expect(phone.cy + phone.r).toBeLessThan(582);
  });

  it("is the same for the same layout (it only moves when the layout does)", () => {
    const l = LAYOUTS[0];
    expect(heroSlot({ w: l.w, h: l.h }, l.keep, { pad: 16, margin: 12, maxR: 300 })).toEqual(heroSlot({ w: l.w, h: l.h }, l.keep, { pad: 16, margin: 12, maxR: 300 }));
  });
});
