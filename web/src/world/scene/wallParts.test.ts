import { describe, expect, it, vi } from "vitest";
import { Box3, BufferGeometry, Vector3 } from "three";
import { loadTwinRobot } from "../../twin/loadTwinRobot";
import { readPublic } from "../../twin/testFiles";
import { CATALOG } from "../stations/robots/catalog";
import { buildPools, buildWall, frankaPieces, partGeometry, standIn, STAND_INS } from "./wallParts";
import { ITEM_SIZE, WALL, wallPlan, type ItemKind } from "./wallPlan";

const EPS = 1e-3;

function fits(g: BufferGeometry, kind: ItemKind) {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const s = ITEM_SIZE[kind];
  expect(b.min.y).toBeGreaterThanOrEqual(-EPS);
  expect(b.max.y).toBeLessThanOrEqual(s.height + EPS);
  expect(Math.max(-b.min.x, b.max.x)).toBeLessThanOrEqual(s.depth / 2 + EPS);
  expect(Math.max(-b.min.z, b.max.z)).toBeLessThanOrEqual(s.width / 2 + EPS);
}

const franka = async () => {
  const fetchImpl = vi.fn(async (url: string) => new Response(await readPublic(url)));
  const files = { urdf: "/robots/franka_description/robots/panda_arm_hand.urdf", packages: { franka_description: "/robots/franka_description" } };
  const { robot } = await loadTwinRobot(files, fetchImpl as unknown as typeof fetch);
  return frankaPieces(robot);
};

describe("the robot wall's parts", () => {
  it("builds every part kind inside its footprint, standing on the board, with colours", () => {
    for (const kind of ["gripper", "wrist", "link", "motor", "base"] as const)
      for (const variant of [0, 1, 2, 3]) {
        const g = partGeometry(kind, variant);
        fits(g, kind);
        expect(g.getAttribute("color")).toBeTruthy();
        expect(g.getAttribute("normal")).toBeTruthy();
      }
  });

  it("has a stand-in for every catalog robot but the Franka, which is built from its URDF", () => {
    expect(Object.keys(STAND_INS).sort()).toEqual(CATALOG.map((r) => r.id).filter((id) => id !== "franka").sort());
    for (const id of Object.keys(STAND_INS)) fits(standIn(id), "robot");
  });

  it("poses the Franka from its collision meshes, and cuts out its links as specimens", async () => {
    const f = await franka();
    fits(f.arm, "robot");
    expect(Object.keys(f.links).sort()).toEqual(["hand", "link1", "link2", "link3", "link4", "link5", "link6", "link7"]);
    for (const g of Object.values(f.links)) fits(g, "franka-link");
  });

  it("merges the whole wall into one geometry, every vertex on the side walls' shelves", async () => {
    const plan = wallPlan();
    const g = buildWall(plan, await franka());
    expect(g.groups.length).toBeLessThanOrEqual(1);
    const p = g.getAttribute("position");
    const box = new Box3().setFromBufferAttribute(p as never);
    expect(box.min.y).toBeGreaterThan(1.3);
    const v = new Vector3();
    for (let i = 0; i < p.count; i += 97) {
      v.fromBufferAttribute(p as never, i);
      expect(Math.abs(v.x)).toBeGreaterThanOrEqual(WALL.inner - 0.4);
      expect(Math.abs(v.x)).toBeLessThanOrEqual(WALL.outer + EPS);
    }
  });

  it("tags each catalog robot's vertices with its number (1-based); parts, plinths and cards with 0", async () => {
    const numbers = (g: BufferGeometry) => {
      const item = g.getAttribute("aSpot");
      const seen = new Set<number>();
      for (let i = 0; i < item.count; i++) seen.add(item.getW(i));
      return [...seen].sort();
    };
    expect(numbers(buildWall(wallPlan(), await franka()))).toEqual([0, 1, 2, 3, 4, 5]);
    // Without the Franka's meshes (still loading) its place shows only its plinth, which never lights.
    expect(numbers(buildWall(wallPlan(), null))).toEqual([0, 2, 3, 4, 5]);
  });

  it("gives each item one pool of light on the wall behind it", () => {
    const plan = wallPlan();
    expect(buildPools(plan).getAttribute("position").count).toBe(plan.length * 4);
  });
});
