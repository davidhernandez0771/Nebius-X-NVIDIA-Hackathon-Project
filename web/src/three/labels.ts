import type { V3 } from "./sceneMath";

// One system for annotations: anchor point on a 3D part -> thin leader line
// -> tiny mono label (or glass card). The scene projects anchors to screen
// space each frame; the DOM layer reads them in the same frame via `hooks`.

export type LeaderGroup = "parts" | "review" | "shelf";

export interface LeaderDef {
  id: string;
  group: LeaderGroup;
  /** part id in the room model */
  part: string;
  /** anchor offset in the part's local space */
  local: V3;
  /** label offset from the anchor, in px (desktop) */
  dx: number;
  dy: number;
  kind: "mono" | "card";
  text: string;
  sub?: string;
}

export const LEADERS: LeaderDef[] = [
  // chapter 2: the exploded view, labelled like a technical diagram
  { id: "p-shelf", group: "parts", part: "shelf", local: [0.65, 1.7, 0], dx: 70, dy: -70, kind: "mono", text: "SHELF_A", sub: "3 LEVELS" },
  { id: "p-desk", group: "parts", part: "desk", local: [0.7, 0.75, 0.3], dx: 90, dy: -40, kind: "mono", text: "DESK", sub: "SURFACE 1.5 x 0.7" },
  { id: "p-sofa", group: "parts", part: "sofa", local: [0.4, 0.7, 0.9], dx: 90, dy: 30, kind: "mono", text: "SOFA", sub: "3 SEATS" },
  { id: "p-lamp", group: "parts", part: "lamp", local: [0, 0.6, 0], dx: -95, dy: -55, kind: "mono", text: "LAMP", sub: "CONF 0.91" },
  { id: "p-wall", group: "parts", part: "wallBack", local: [2.2, 2.3, 0], dx: 60, dy: -50, kind: "mono", text: "WALL.N", sub: "GLASS" },
  { id: "p-floor", group: "parts", part: "floor", local: [1.8, 0, 2.0], dx: 70, dy: 50, kind: "mono", text: "FLOOR", sub: "4.6 x 4.6 M" },
  // chapter 3: candidate items pinned where they were seen
  { id: "r-mug", group: "review", part: "mug", local: [0, 0.06, 0], dx: -120, dy: -70, kind: "card", text: "Blue mug", sub: "on the desk" },
  { id: "r-charger", group: "review", part: "charger", local: [0, 0.04, 0], dx: -150, dy: 20, kind: "card", text: "Charger", sub: "on the rug" },
  { id: "r-book", group: "review", part: "book", local: [0, 0.04, 0], dx: -130, dy: 90, kind: "card", text: "Paperback", sub: "on the rug" },
  // chapter 4: shelf slots as things land
  { id: "s-a", group: "shelf", part: "shelf", local: [0.65, 1.2, 0], dx: 90, dy: -30, kind: "mono", text: "SLOT A", sub: "2 ITEMS" },
  { id: "s-b", group: "shelf", part: "shelf", local: [0.65, 0.65, 0], dx: 90, dy: 0, kind: "mono", text: "SLOT B", sub: "3 ITEMS" },
  { id: "s-c", group: "shelf", part: "shelf", local: [0.65, 0.1, 0], dx: 90, dy: 30, kind: "mono", text: "SLOT C", sub: "3 ITEMS" },
];

export interface ScreenPoint {
  x: number;
  y: number;
  /** false when behind the camera */
  on: boolean;
}

export const anchors: Record<string, ScreenPoint> = {};

const hooks = new Set<() => void>();
export const onSceneFrame = (fn: () => void) => {
  hooks.add(fn);
  return () => hooks.delete(fn);
};
export const emitSceneFrame = () => hooks.forEach((fn) => fn());
