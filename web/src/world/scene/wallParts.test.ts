import { beforeAll, describe, expect, it } from "vitest";
import { Box3, BufferGeometry, Vector3 } from "three";
import { readPublic } from "../../twin/testFiles";
import { CATALOG } from "../stations/robots/catalog";
import { MODEL_IDS, parseRobotModel, type ModelId } from "./robotModels";
import { PART_MAX_TRIS, PART_MAX_TRIS_LOW, ROBOT_SCALE, STAND_INS, buildPools, buildWall, partGeometry, robotGeometry, standIn, wallModels, type WallModels } from "./wallParts";
import { ITEM_SIZE, WALL, wallPlan, type ItemKind } from "./wallPlan";

const EPS = 1e-3;
const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

function fits(g: BufferGeometry, kind: ItemKind) {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const s = ITEM_SIZE[kind];
  expect(b.min.y).toBeGreaterThanOrEqual(-EPS);
  expect(b.max.y).toBeLessThanOrEqual(s.height + EPS);
  expect(Math.max(-b.min.x, b.max.x)).toBeLessThanOrEqual(s.depth / 2 + EPS);
  expect(Math.max(-b.min.z, b.max.z)).toBeLessThanOrEqual(s.width / 2 + EPS);
}

const parsed: Partial<Record<ModelId, BufferGeometry>> = {};
beforeAll(async () => {
  for (const id of MODEL_IDS) {
    // A copy in this realm's ArrayBuffer: GLTFLoader tells a GLB from JSON with instanceof ArrayBuffer.
    const bytes = new Uint8Array(await readPublic(`world/models/robots/${id}.glb`));
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    parsed[id] = await parseRobotModel(copy.buffer);
  }
});
const lib = (ids: readonly ModelId[] = MODEL_IDS, maxTris?: number): WallModels => wallModels(Object.fromEntries(ids.map((id) => [id, parsed[id]!])), maxTris);
const LOW: readonly ModelId[] = ["franka", "openarm", "so101", "piper"];

describe("the robot wall's robots and parts", () => {
  it("stands every robot's real model at one scale inside the robot footprint, standing on the board", () => {
    const height: Record<string, number> = {};
    for (const id of MODEL_IDS) {
      const g = robotGeometry(parsed[id]!);
      fits(g, "robot");
      expect(g.getAttribute("color")).toBeTruthy();
      height[id] = g.boundingBox!.max.y - g.boundingBox!.min.y;
    }
    // One scale for all: the wall shows their real sizes against each other.
    const real = (id: ModelId) => {
      parsed[id]!.computeBoundingBox();
      const b = parsed[id]!.boundingBox!;
      return b.max.y - b.min.y;
    };
    expect(height.ur5e).toBeCloseTo(real("ur5e") * ROBOT_SCALE, 3);
    expect(height.ur5e / height.so101).toBeCloseTo(real("ur5e") / real("so101"), 3);
  });

  it("keeps a stand-in only for the catalog robot with no open meshes (the Flexiv)", () => {
    expect(CATALOG.filter((r) => !(MODEL_IDS as readonly string[]).includes(r.id)).map((r) => r.id)).toEqual(["flexiv"]);
    expect(Object.keys(STAND_INS)).toEqual(["flexiv"]);
    fits(standIn("flexiv"), "robot");
  });

  it("turns pieces of the models into parts that fit their footprints, mixing the robots, none too heavy", () => {
    const l = lib();
    expect(l.pieces.length).toBeGreaterThanOrEqual(30);
    // Interleaved: the first pieces come one from each robot.
    expect(new Set(l.sources.slice(0, MODEL_IDS.length))).toEqual(new Set(MODEL_IDS));
    for (const p of l.pieces) expect(tris(p)).toBeLessThanOrEqual(PART_MAX_TRIS);
    for (const kind of ["part", "part-lg"] as const)
      for (const p of l.pieces.slice(0, 12)) {
        const g = partGeometry(p, kind);
        fits(g, kind);
        expect(g.getAttribute("color")).toBeTruthy();
      }
  });

  it("merges the whole wall into one geometry, every vertex on the side walls' shelves", () => {
    const g = buildWall(wallPlan(), lib());
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

  it("stays inside a triangle budget, still one draw call: the full wall, and the low tier's (four models, no extras, lighter pieces)", () => {
    expect(tris(buildWall(wallPlan(), lib()))).toBeLessThan(180_000); // measured 169,675
    expect(tris(buildWall(wallPlan({ extras: false }), lib(LOW, PART_MAX_TRIS_LOW)))).toBeLessThan(120_000); // measured 110,601
  });

  it("tags each catalog robot's vertices with its number (1-based); extras, parts, plinths and cards with 0", () => {
    const numbers = (g: BufferGeometry) => {
      const item = g.getAttribute("aSpot");
      const seen = new Set<number>();
      for (let i = 0; i < item.count; i++) seen.add(item.getW(i));
      return [...seen].sort();
    };
    expect(numbers(buildWall(wallPlan(), lib()))).toEqual([0, 1, 2, 3, 4, 5]);
    // Before the models are in, only the plinths, the cards and the Flexiv's stand-in (number 2) stand.
    expect(numbers(buildWall(wallPlan(), null))).toEqual([0, 2]);
  });

  it("gives each item one pool of light on the wall behind it", () => {
    const plan = wallPlan();
    expect(buildPools(plan).getAttribute("position").count).toBe(plan.length * 4);
  });
});
