// Geometry for the role cables: a socket above the tree to a part's port on the right edge of its row.
export type Pt = { x: number; y: number };

/** A cubic that drops out of the socket and swings into the port from the right, with a minimum bend. */
export function cablePath(from: Pt, to: Pt): string {
  const drop = Math.max(40, Math.abs(to.y - from.y) / 2);
  const swing = Math.max(40, Math.abs(to.x - from.x) * 0.4);
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + drop}, ${to.x + swing} ${to.y}, ${to.x} ${to.y}`;
}

/** A press that moved less than this is a click (arms the socket) rather than a drag. */
export function isClick(down: Pt, up: Pt, slop = 5): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) < slop;
}
