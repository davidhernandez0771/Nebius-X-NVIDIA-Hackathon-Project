import { describe, expect, it } from "vitest";
import { CATALOG } from "../stations/robots/catalog";
import { BOARDS, CLEAR, ITEM_SIZE, WALL, robotSpot, wallPlan, type WallItem } from "./wallPlan";

const plan = wallPlan();
const row = (side: number, board: number) => plan.filter((i) => i.side === side && i.board === board).sort((a, b) => a.z - b.z);

describe("the robot wall's plan", () => {
  it("stands the five catalog robots on the left wall's middle shelf, in the catalog's order left to right", () => {
    const robots = plan.filter((i) => i.kind === "robot");
    expect(robots.map((r) => r.robot)).toEqual(CATALOG.map((r) => r.id));
    for (const r of robots) expect([r.side, r.board]).toEqual([-1, 1]);
    // Seen from the room, the left wall's left is +z: the catalog reads left to right as z falls.
    const z = robots.map((r) => r.z);
    expect([...z].sort((a, b) => b - a)).toEqual(z);
  });

  it("fills both walls with parts: grippers, wrists, arm links, the Franka's own link meshes", () => {
    const kinds = new Set(plan.map((i) => i.kind));
    for (const k of ["gripper", "wrist", "link", "franka-link", "motor"] as const) expect(kinds).toContain(k);
    expect(plan.filter((i) => i.side === 1).length).toBeGreaterThan(20);
    expect(plan.filter((i) => i.side === -1 && i.kind !== "robot").length).toBeGreaterThan(15);
  });

  it("keeps every item on its shelf: inside the boards' length, under the next board, nothing touching", () => {
    for (const side of [-1, 1])
      for (const board of [0, 1, 2]) {
        const items = row(side, board);
        items.forEach((it: WallItem, k) => {
          const w = ITEM_SIZE[it.kind].width;
          expect(it.z - w / 2).toBeGreaterThanOrEqual(WALL.z[0] + 0.3);
          expect(it.z + w / 2).toBeLessThanOrEqual(WALL.z[1] - 0.3);
          expect(ITEM_SIZE[it.kind].height).toBeLessThanOrEqual(CLEAR);
          const next = items[k + 1];
          if (next) expect(next.z - ITEM_SIZE[next.kind].width / 2 - (it.z + w / 2)).toBeGreaterThanOrEqual(0.3);
        });
      }
  });

  it("fits every item in the shelf's depth", () => {
    for (const k of Object.values(ITEM_SIZE)) expect(k.depth).toBeLessThanOrEqual(WALL.outer - WALL.inner - 0.1);
  });

  it("is the same wall on every visit", () => {
    expect(wallPlan()).toEqual(plan);
  });

  it("puts a robot's spot on its board, in the middle of the shelf's depth, facing the room", () => {
    const s = robotSpot("franka");
    expect(s.position[1]).toBeCloseTo(BOARDS[1], 6);
    expect(s.position[0]).toBeCloseTo(-(WALL.inner + WALL.outer) / 2, 6);
    expect(s.facing).toEqual([1, 0, 0]);
    expect(() => robotSpot("nope")).toThrow();
  });
});
