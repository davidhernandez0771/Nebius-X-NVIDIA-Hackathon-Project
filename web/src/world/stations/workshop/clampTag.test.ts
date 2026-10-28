// site bug hunt (2026-10-26): on a phone the room view's tag cards "03 The bench" and "04 The wall" were cut off at
// the left edge: nothing kept a card on screen. keepOnScreen says how far to slide one so all of it shows.
import { describe, expect, it } from "vitest";
import { TAG_MARGIN, keepOnScreen, placeCards } from "./clampTag";

describe("keeping a hub tag's card on screen", () => {
  it("leaves a card that fits where it is", () => {
    expect(keepOnScreen(40, 220, 390)).toBe(0);
  });
  it("slides one cut off at the left edge in, to the margin", () => {
    expect(keepOnScreen(-60, 120, 390)).toBe(60 + TAG_MARGIN);
  });
  it("slides one past the right edge back in", () => {
    expect(keepOnScreen(300, 480, 390)).toBe(390 - TAG_MARGIN - 480);
  });
  it("keeps the left edge on screen for a card wider than the screen", () => {
    expect(keepOnScreen(-20, 500, 390)).toBe(20 + TAG_MARGIN);
  });
});

describe("placing the cards together", () => {
  const box = (left: number, top: number, w = 176, h = 70) => ({ left, right: left + w, top, bottom: top + h });
  it("leaves cards that are on screen and apart where they are", () => {
    expect(placeCards([box(20, 100), box(206, 100), box(20, 300)], 390)).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
  });
  it("slides cards in from the edge, and down past each other when they would land on one another", () => {
    const boxes = [box(-120, 100), box(-60, 120), box(-200, 110)];
    const out = placeCards(boxes, 390);
    const placed = boxes.map((b, i) => ({ left: b.left + out[i].dx, right: b.right + out[i].dx, top: b.top + out[i].dy, bottom: b.bottom + out[i].dy }));
    for (const p of placed) {
      expect(p.left).toBeGreaterThanOrEqual(TAG_MARGIN);
      expect(p.right).toBeLessThanOrEqual(390 - TAG_MARGIN);
    }
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const [a, b] = [placed[i], placed[j]];
        expect(a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left, `${i} / ${j}`).toBe(true);
      }
    // The topmost stays at its height.
    expect(out[0].dy).toBe(0);
  });
});
