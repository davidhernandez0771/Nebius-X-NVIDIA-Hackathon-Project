// Where the guide's card stands, given what its step points at (a box on screen, or nothing) and the viewport. Pure,
// so it is tested. A desktop: under the target if it fits, else over it, else beside it, centred on it and kept
// 16 px inside the window; with no target, in the middle a little low. A phone (under 700 px): docked full width at
// the bottom (the room's tags sit in the middle of the screen there), or at the top when the target is down there.
// The connector is a straight line from the card's near edge to the target's near edge.

export type Box = { left: number; top: number; width: number; height: number };
export type Line = { x1: number; y1: number; x2: number; y2: number };
export type Placement = { left: number; top: number; width: number | null; side: "below" | "above" | "right" | "left" | "center" | "dock"; line: Line | null };

export const GUTTER = 16;
/** Between the card and the target. */
export const GAP = 18;
/** Narrower than this is a phone. */
export const PHONE = 700;
/** On a phone docked at the top, the card stays under the room's hub bar. */
export const PHONE_TOP = 72;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function placeCard(target: Box | null, card: { w: number; h: number }, vw: number, vh: number): Placement {
  const { w, h } = card;
  if (vw < PHONE) {
    const width = vw - GUTTER * 2;
    let top = vh - h - GUTTER;
    if (target && target.top + target.height + GAP > top && target.top - GAP > PHONE_TOP + h) top = PHONE_TOP;
    top = Math.max(GUTTER, top);
    let line: Line | null = null;
    if (target) {
      const x = clamp(target.left + target.width / 2, GUTTER + 12, vw - GUTTER - 12);
      const below = target.top + target.height;
      if (top > below) line = { x1: x, y1: top, x2: x, y2: below };
      else if (top + h < target.top) line = { x1: x, y1: top + h, x2: x, y2: target.top };
    }
    return { left: GUTTER, top, width, side: "dock", line };
  }
  if (!target) {
    return { left: Math.round((vw - w) / 2), top: Math.round(clamp(vh * 0.56 - h / 2, GUTTER, vh - h - GUTTER)), width: null, side: "center", line: null };
  }
  const cx = target.left + target.width / 2;
  const cy = target.top + target.height / 2;
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const left = Math.round(clamp(cx - w / 2, GUTTER, vw - w - GUTTER));
  const lineX = clamp(cx, left + 12, left + w - 12);
  if (bottom + GAP + h <= vh - GUTTER) {
    const top = Math.round(bottom + GAP);
    return { left, top, width: null, side: "below", line: { x1: lineX, y1: top, x2: lineX, y2: bottom } };
  }
  if (target.top - GAP - h >= GUTTER) {
    const top = Math.round(target.top - GAP - h);
    return { left, top, width: null, side: "above", line: { x1: lineX, y1: top + h, x2: lineX, y2: target.top } };
  }
  const top = Math.round(clamp(cy - h / 2, GUTTER, vh - h - GUTTER));
  const lineY = clamp(cy, top + 12, top + h - 12);
  if (right + GAP + w <= vw - GUTTER) {
    const l = Math.round(right + GAP);
    return { left: l, top, width: null, side: "right", line: { x1: l, y1: lineY, x2: right, y2: lineY } };
  }
  if (target.left - GAP - w >= GUTTER) {
    const l = Math.round(target.left - GAP - w);
    return { left: l, top, width: null, side: "left", line: { x1: l + w, y1: lineY, x2: target.left, y2: lineY } };
  }
  return { left: Math.round((vw - w) / 2), top: Math.round(clamp(vh * 0.56 - h / 2, GUTTER, vh - h - GUTTER)), width: null, side: "center", line: null };
}
