// What stands on the side walls' shelves, and where: the robot wall. The five robots of the catalog
// (stations/robots/catalog.ts) stand on the left wall's middle shelf, at eye level for the robots
// view, in the catalog's order; robot parts (grippers, wrists, arm links, the Franka's own link meshes,
// motors, bases) fill the other shelves like a museum's study collection. Pure and repeatable (no
// Math.random), so it is tested; RobotWall.tsx builds the meshes from it.
//
// The shelves are in shelves.glb: three boards on each side wall, their tops at y 1.46, 4.66 and 7.86,
// 1.6 m deep (|x| 20.0 to 21.6) and running z −15 to 7. The left wall is x < 0.
import type { Vec3 } from "../core/types";
import { CATALOG } from "../stations/robots/catalog";

export const BOARDS = [1.46, 4.66, 7.86] as const;
/** Free height over a board: the next board's underside is 3.08 m up. */
export const CLEAR = 2.9;
export const WALL = { inner: 20.0, outer: 21.6, z: [-15, 7] as const };

export type ItemKind = "robot" | "gripper" | "wrist" | "link" | "franka-link" | "motor" | "base";

/** Each kind's footprint: width along the wall (z), depth into the shelf (x) and height, metres. */
export const ITEM_SIZE: Record<ItemKind, { width: number; depth: number; height: number }> = {
  robot: { width: 2.0, depth: 1.4, height: 2.75 },
  gripper: { width: 1.1, depth: 1.0, height: 1.5 },
  wrist: { width: 0.9, depth: 1.0, height: 1.2 },
  link: { width: 1.5, depth: 0.9, height: 2.3 },
  "franka-link": { width: 1.2, depth: 1.2, height: 1.9 },
  motor: { width: 0.8, depth: 0.9, height: 0.95 },
  base: { width: 1.2, depth: 1.2, height: 0.9 },
};

/** The Franka's collision meshes (web/public/robots/franka_description) that stand as specimens. */
export const FRANKA_LINKS = ["link1", "link2", "link3", "link4", "link5", "link6", "link7", "hand"] as const;

export interface WallItem {
  kind: ItemKind;
  /** -1: the left wall (x < 0), 1: the right. */
  side: -1 | 1;
  board: 0 | 1 | 2;
  /** The item's centre along the wall. */
  z: number;
  /** Picks a look within the kind (a gripper's style, a link's length…). */
  variant: number;
  robot?: string;
  /** For "franka-link": which collision mesh. */
  mesh?: (typeof FRANKA_LINKS)[number];
}

/** The robots' centres on the left wall's middle board, in the catalog's order (+z is the wall's left). */
const ROBOT_Z = [3.6, 1.28, -1.04, -3.36, -5.68];
const GAP = 0.45;

function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
}

const PART_CYCLE: readonly ItemKind[] = ["gripper", "link", "wrist", "franka-link", "motor", "gripper", "base", "link", "wrist", "franka-link"];

/** Parts along one row from z `hi` down to `lo`, each a gap apart. */
function fill(side: -1 | 1, board: 0 | 1 | 2, lo: number, hi: number, seed: number, out: WallItem[], franka: { next: number }): void {
  let z = hi;
  let k = 0;
  while (true) {
    const kind = PART_CYCLE[(seed + k) % PART_CYCLE.length];
    const w = ITEM_SIZE[kind].width;
    if (z - w < lo) break;
    const item: WallItem = { kind, side, board, z: z - w / 2, variant: Math.floor(hash(seed * 31 + k) * 4) };
    if (kind === "franka-link") item.mesh = FRANKA_LINKS[franka.next++ % FRANKA_LINKS.length];
    out.push(item);
    z -= w + GAP + Math.round(hash(seed * 17 + k) * 4) * 0.15;
    k++;
  }
}

export function wallPlan(): WallItem[] {
  const out: WallItem[] = [];
  const franka = { next: 0 };
  const lo = WALL.z[0] + 0.3;
  const hi = WALL.z[1] - 0.3;
  CATALOG.forEach((r, i) => out.push({ kind: "robot", side: -1, board: 1, z: ROBOT_Z[i], variant: 0, robot: r.id }));
  const robotsHi = ROBOT_Z[0] + ITEM_SIZE.robot.width / 2;
  const robotsLo = ROBOT_Z[ROBOT_Z.length - 1] - ITEM_SIZE.robot.width / 2;
  ([-1, 1] as const).forEach((side, s) =>
    ([0, 1, 2] as const).forEach((board) => {
      const seed = s * 3 + board + 1;
      if (side === -1 && board === 1) {
        fill(side, board, robotsHi + GAP, hi, seed, out, franka);
        fill(side, board, lo, robotsLo - GAP, seed + 5, out, franka);
      } else fill(side, board, lo, hi, seed, out, franka);
    }),
  );
  return out;
}

/** Where an item stands: on its board, in the middle of the shelf's depth. */
export function itemBase(it: Pick<WallItem, "side" | "board" | "z">): Vec3 {
  return [(it.side * (WALL.inner + WALL.outer)) / 2, BOARDS[it.board], it.z];
}

/** A catalog robot's place on the wall, and the way it faces (into the room). */
export function robotSpot(id: string): { position: Vec3; facing: Vec3; height: number } {
  const it = wallPlan().find((i) => i.robot === id);
  if (!it) throw new Error(`world: no robot "${id}" on the wall`);
  return { position: itemBase(it), facing: [-it.side, 0, 0], height: ITEM_SIZE.robot.height };
}
