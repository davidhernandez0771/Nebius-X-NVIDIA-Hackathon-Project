// Where the guide's card stands: next to its target, never off the window, docked on a phone.
import { describe, expect, it } from "vitest";
import { GUTTER, placeCard, type Box } from "./guidePlace";

const card = { w: 380, h: 260 };
const inside = (p: { left: number; top: number; width: number | null }, vw: number, vh: number, h = card.h) => {
  const w = p.width ?? card.w;
  expect(p.left).toBeGreaterThanOrEqual(GUTTER);
  expect(p.left + w).toBeLessThanOrEqual(vw - GUTTER);
  expect(p.top).toBeGreaterThanOrEqual(GUTTER);
  expect(p.top + h).toBeLessThanOrEqual(vh - GUTTER);
};
const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

describe("the guide card's place", () => {
  it("with nothing to point at, stands in the middle", () => {
    const p = placeCard(null, card, 1280, 720);
    expect(p.side).toBe("center");
    expect(p.left).toBe(450);
    expect(p.line).toBeNull();
    inside(p, 1280, 720);
  });

  it("stands under a target near the top, over one near the bottom, with a line to it", () => {
    const top: Box = { left: 503, top: 54, width: 240, height: 128 };
    const a = placeCard(top, card, 1280, 720);
    expect(a.side).toBe("below");
    expect(a.top).toBe(54 + 128 + 18);
    expect(a.line).toEqual({ x1: 623, y1: a.top, x2: 623, y2: 182 });
    const low: Box = { left: 600, top: 560, width: 200, height: 80 };
    const b = placeCard(low, card, 1280, 720);
    expect(b.side).toBe("above");
    expect(b.top + card.h).toBe(560 - 18);
  });

  it("never covers its target and never leaves the window, wherever the target is (1280×720)", () => {
    for (let x = -100; x < 1300; x += 97)
      for (let y = -40; y < 740; y += 61) {
        const t: Box = { left: x, top: y, width: 240, height: 100 };
        const p = placeCard(t, card, 1280, 720);
        inside(p, 1280, 720);
        if (p.side !== "center") expect(overlaps({ left: p.left, top: p.top, width: card.w, height: card.h }, t)).toBe(false);
      }
  });

  it("on a phone (390 px), docks full width at the bottom, or at the top when the target is down there", () => {
    const mid = placeCard({ left: 98, top: 236, width: 176, height: 89 }, { w: 358, h: 300 }, 390, 844);
    expect(mid).toMatchObject({ side: "dock", left: 16, width: 358, top: 844 - 300 - 16 });
    expect(mid.line).toEqual({ x1: 186, y1: 528, x2: 186, y2: 325 });
    const low = placeCard({ left: 20, top: 700, width: 176, height: 64 }, { w: 358, h: 300 }, 390, 844);
    expect(low.top).toBe(72);
    expect(low.line).toEqual({ x1: 108, y1: 372, x2: 108, y2: 700 });
    inside(low, 390, 844, 300);
  });
});
