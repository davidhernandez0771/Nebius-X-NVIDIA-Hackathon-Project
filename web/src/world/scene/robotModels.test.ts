import { describe, expect, it } from "vitest";
import { BufferGeometry, Color, Vector3 } from "three";
import { readPublic } from "../../twin/testFiles";
import { MODEL_IDS, MODEL_COLOR, modelPieces, parseRobotModel, robotModelUrl } from "./robotModels";

// A copy in this realm's ArrayBuffer: GLTFLoader tells a GLB from JSON with instanceof ArrayBuffer.
const load = async (id: string) => {
  const bytes = new Uint8Array(await readPublic(`world/models/robots/${id}.glb`));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return parseRobotModel(copy.buffer);
};
const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

describe("the robots' models (docs/design/blender/robots.blend, from each maker's published meshes)", () => {
  it("has one GLB per robot on the wall, served from world/models/robots", () => {
    expect([...MODEL_IDS].sort()).toEqual(["fr3", "franka", "openarm", "piper", "so101", "ur5e", "xarm6"]);
    expect(robotModelUrl("ur5e")).toMatch(/world\/models\/robots\/ur5e\.glb$/);
  });

  it("parses each into one geometry with a colour per vertex, standing on y = 0, at its real size in metres", async () => {
    const heights: Record<string, number> = {};
    for (const id of MODEL_IDS) {
      const g = await load(id);
      expect(g.getAttribute("color")).toBeTruthy();
      expect(g.getAttribute("normal")).toBeTruthy();
      expect(g.groups.length).toBeLessThanOrEqual(1);
      expect(tris(g)).toBeGreaterThan(10000);
      expect(tris(g)).toBeLessThan(16000);
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.01);
      heights[id] = g.boundingBox!.max.y;
    }
    // Real sizes, not fitted: the UR5e is the tallest, the SO-101 a desktop arm.
    expect(heights.ur5e).toBeCloseTo(0.81, 1);
    expect(heights.so101).toBeLessThan(0.25);
    expect(heights.franka).toBeGreaterThan(heights.piper);
  });

  it("keeps every colour between graphite and the wall's paint, so the picture lights show the shape", async () => {
    const lum = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    for (const id of ["piper", "franka"]) {
      const col = (await load(id)).getAttribute("color");
      const c = new Color();
      for (let i = 0; i < col.count; i += 13) {
        c.fromBufferAttribute(col as never, i);
        expect(lum(c)).toBeGreaterThanOrEqual(lum(MODEL_COLOR.darkest) - 1e-6);
        expect(Math.max(c.r, c.g, c.b)).toBeLessThanOrEqual(MODEL_COLOR.brightest + 1e-6);
      }
    }
  });

  it("cuts each model into its real pieces (link shells with what sits on them), largest first, standing upright", async () => {
    for (const id of MODEL_IDS) {
      const g = await load(id);
      const pieces = modelPieces(g);
      expect(pieces.length).toBeGreaterThanOrEqual(4);
      for (const p of pieces) expect(tris(p)).toBeGreaterThan(40);
      // No piece is the whole arm: each one's longest side is well under the arm's.
      g.computeBoundingBox();
      const arm = g.boundingBox!.getSize(new Vector3());
      for (const p of pieces) {
        p.computeBoundingBox();
        const s = p.boundingBox!.getSize(new Vector3());
        expect(Math.max(s.x, s.y, s.z)).toBeLessThan(0.8 * Math.max(arm.x, arm.y, arm.z));
      }
      for (const p of pieces) {
        expect(p.getAttribute("color")).toBeTruthy();
        p.computeBoundingBox();
        const b = p.boundingBox!;
        // Upright: its longest side is the height, and it stands on y = 0, centred.
        expect(b.max.y - b.min.y + 1e-6).toBeGreaterThanOrEqual(Math.max(b.max.x - b.min.x, b.max.z - b.min.z));
        expect(b.min.y).toBeCloseTo(0, 6);
        expect(Math.abs(b.min.x + b.max.x)).toBeLessThan(1e-4);
        expect(Math.abs(b.min.z + b.max.z)).toBeLessThan(1e-4);
      }
      // Largest first (by bounding volume).
      const vol = pieces.map((p) => {
        const b = p.boundingBox!;
        return (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
      });
      expect([...vol].sort((a, b) => b - a)).toEqual(vol);
    }
  });
});
