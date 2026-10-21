// What stands on the side walls' shelves, and where: the robot wall. The five robots of the catalog
// (stations/robots/catalog.ts) stand on the left wall's middle shelf, at eye level for the robots
// view, in the catalog's order; three arms SANT hasn't run (EXTRA_ROBOTS) stand on the right wall's
// middle shelf, opposite. Real parts (pieces of the same robots' meshes, robotModels.ts) fill the other
// shelves like a museum's study collection. Pure and repeatable (no Math.random), so it is tested;
// RobotWall.tsx builds the meshes from it.
//
// The shelves are in shelves.glb: three boards on each side wall, their tops at y 1.46, 4.66 and 7.86,
// 1.6 m deep (|x| 20.0 to 21.6) and running z −15 to 7. The left wall is x < 0.
import type { Vec3 } from "../core/types";
import { CATALOG, WALL_ONLY } from "../stations/robots/catalog";

export const BOARDS = [1.46, 4.66, 7.86] as const;
/** Free height over a board: the next board's underside is 3.08 m up. */
export const CLEAR = 2.9;
export const WALL = { inner: 20.0, outer: 21.6, z: [-15, 7] as const };

/** The arms on the wall that SANT hasn't run (catalog.ts WALL_ONLY): their makers' meshes, for comparison. */
export const EXTRA_ROBOTS: readonly string[] = WALL_ONLY.map((r) => r.id);

export type ItemKind = "robot" | "part" | "part-lg";

/** Each kind's footprint: width along the wall (z), depth into the shelf (x) and height, metres. */
export const ITEM_SIZE: Record<ItemKind, { width: number; depth: number; height: number }> = {
  robot: { width: 2.0, depth: 1.4, height: 2.75 },
  part: { width: 0.9, depth: 0.9, height: 1.3 },
  "part-lg": { width: 1.3, depth: 1.1, height: 1.9 },
};

export interface WallItem {
  kind: ItemKind;
  /** -1: the left wall (x < 0), 1: the right. */
  side: -1 | 1;
  board: 0 | 1 | 2;
  /** The item's centre along the wall. */
  z: number;
  /** A part's running number (which real piece it shows); 0 for robots. */
  variant: number;
  robot?: string;
  /** A robot on the wall that isn't in the catalog. */
  extra?: boolean;
}

/** The robots' centres on the middle board, in order (+z is the left wall's left, as seen from the room). */
const ROBOT_Z = [3.6, 1.28, -1.04, -3.36, -5.68];
const EXTRA_Z = [1.28, -1.04, -3.36];
const GAP = 0.45;

function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
}

const PART_CYCLE: readonly ItemKind[] = ["part", "part-lg", "part", "part", "part-lg", "part", "part-lg"];

/** Parts along one row from z `hi` down to `lo`, each a gap apart. */
function fill(side: -1 | 1, board: 0 | 1 | 2, lo: number, hi: number, seed: number, out: WallItem[]): void {
  let z = hi;
  let k = 0;
  while (true) {
    const kind = PART_CYCLE[(seed + k) % PART_CYCLE.length];
    const w = ITEM_SIZE[kind].width;
    if (z - w < lo) break;
    out.push({ kind, side, board, z: z - w / 2, variant: 0 });
    z -= w + GAP + Math.round(hash(seed * 17 + k) * 4) * 0.15;
    k++;
  }
}

/** The wall. `extras: false` (the low tier) leaves the three extra robots out and fills their shelf with parts. */
export function wallPlan({ extras = true }: { extras?: boolean } = {}): WallItem[] {
  const out: WallItem[] = [];
  const lo = WALL.z[0] + 0.3;
  const hi = WALL.z[1] - 0.3;
  CATALOG.forEach((r, i) => out.push({ kind: "robot", side: -1, board: 1, z: ROBOT_Z[i], variant: 0, robot: r.id }));
  if (extras) EXTRA_ROBOTS.forEach((id, i) => out.push({ kind: "robot", side: 1, board: 1, z: EXTRA_Z[i], variant: 0, robot: id, extra: true }));
  const rows: [number[], -1 | 1][] = [[ROBOT_Z, -1]];
  if (extras) rows.push([EXTRA_Z, 1]);
  ([-1, 1] as const).forEach((side, s) =>
    ([0, 1, 2] as const).forEach((board) => {
      const seed = s * 3 + board + 1;
      const robots = board === 1 ? rows.find(([, sd]) => sd === side)?.[0] : undefined;
      if (robots) {
        const w = ITEM_SIZE.robot.width / 2;
        fill(side, board, robots[0] + w + GAP, hi, seed, out);
        fill(side, board, lo, robots[robots.length - 1] - w - GAP, seed + 5, out);
      } else fill(side, board, lo, hi, seed, out);
    }),
  );
  let n = 0;
  for (const it of out) if (it.kind !== "robot") it.variant = n++;
  return out;
}

/** Where an item stands: on its board, in the middle of the shelf's depth. */
export function itemBase(it: Pick<WallItem, "side" | "board" | "z">): Vec3 {
  return [(it.side * (WALL.inner + WALL.outer)) / 2, BOARDS[it.board], it.z];
}

/** A catalog robot's place on the wall, and the way it faces (into the room). */
export function robotSpot(id: string): { position: Vec3; facing: Vec3; height: number } {
  const it = wallPlan().find((i) => i.robot === id && !i.extra);
  if (!it) throw new Error(`world: no catalog robot "${id}" on the wall`);
  return { position: itemBase(it), facing: [-it.side, 0, 0], height: ITEM_SIZE.robot.height };
}
