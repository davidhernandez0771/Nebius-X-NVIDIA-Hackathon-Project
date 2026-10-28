// Keeping the room view's tag cards on screen (site bug hunt, 2026-10-26): a card is centred on its object's point
// (HubTags), so near a side of a narrow screen (a phone: "03 The bench", "04 The wall") part of it was off the edge.
// keepOnScreen says how far to slide a card sideways so all of it shows; HubTags writes it as the card's own CSS
// `translate` (drei's Html owns the transform of the element round it). Pure, so it is tested.

/** The gap kept between a card and the screen's edge (px). */
export const TAG_MARGIN = 8;

/** How far (px, + to the right) to slide a card spanning `left`–`right` on a screen `width` wide. */
export function keepOnScreen(left: number, right: number, width: number, margin = TAG_MARGIN): number {
  if (left < margin) return margin - left;
  if (right > width - margin) return Math.max(width - margin - right, margin - left);
  return 0;
}

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Where each card goes (its slide, dx and dy, in px), from where it would stand: slid sideways onto the screen
 * (keepOnScreen), then, top to bottom, slid down past any card already placed that it would cover, so two cards
 * brought in from off the edge don't land on each other (a phone: the wall's, the bench's and the proof wall's).
 */
export function placeCards(boxes: readonly Box[], width: number, gap = TAG_MARGIN): { dx: number; dy: number }[] {
  const out = boxes.map(() => ({ dx: 0, dy: 0 }));
  const placed: Box[] = [];
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].top - boxes[b].top || a - b);
  for (const i of order) {
    const b = boxes[i];
    const dx = keepOnScreen(b.left, b.right, width);
    let dy = 0;
    for (let moved = true; moved; ) {
      moved = false;
      for (const p of placed) {
        const hit = b.left + dx < p.right + gap && p.left < b.right + dx + gap && b.top + dy < p.bottom + gap && p.top < b.bottom + dy + gap;
        if (hit) {
          dy = p.bottom + gap - b.top;
          moved = true;
        }
      }
    }
    out[i] = { dx, dy };
    placed.push({ left: b.left + dx, right: b.right + dx, top: b.top + dy, bottom: b.bottom + dy });
  }
  return out;
}
