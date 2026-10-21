// Where the hero's tesseract floats: the largest round space on screen clear of the page's own boxes (the
// headline, the column, the brand, the rail...), so the 3D mark never runs through the type. Pure: Scene.tsx
// measures the boxes (on load and on resize) and places and sizes the tesseract in the slot; the tests use the
// layouts headless Chrome measured.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Slot {
  /** Its centre and radius, in CSS pixels. */
  cx: number;
  cy: number;
  r: number;
}

export interface SlotOptions {
  /** Clear space kept round every box (px). */
  pad: number;
  /** Clear space kept from the screen's edges (px). */
  margin: number;
  /** Its designed size: never larger than this (px). */
  maxR: number;
}

const toBox = (x: number, y: number, b: Box) => Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));

/** The largest circle (up to maxR) clear of every box and the edges; among the largest, the one nearest the centre. */
export function heroSlot(view: { w: number; h: number }, keep: readonly Box[], o: SlotOptions): Slot {
  const step = Math.max(2, Math.min(view.w, view.h) / 120);
  let best: Slot = { cx: view.w / 2, cy: view.h / 2, r: 0 };
  let bestOff = Infinity;
  for (let y = o.margin; y <= view.h - o.margin; y += step)
    for (let x = o.margin; x <= view.w - o.margin; x += step) {
      let r = Math.min(x - o.margin, y - o.margin, view.w - o.margin - x, view.h - o.margin - y, o.maxR);
      for (const b of keep) r = Math.min(r, toBox(x, y, b) - o.pad);
      if (r <= 0) continue;
      const off = Math.hypot(x - view.w / 2, y - view.h / 2);
      // Bigger wins; within a pixel, nearer the centre.
      if (r > best.r + 1 || (Math.abs(r - best.r) <= 1 && off < bestOff)) {
        best = { cx: x, cy: y, r };
        bestOff = off;
      }
    }
  return best;
}
