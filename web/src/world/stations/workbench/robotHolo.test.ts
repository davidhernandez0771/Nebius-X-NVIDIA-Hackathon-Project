import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { MODEL_IDS } from "../../scene/robotModels";
import { ROBOTS } from "../../scene/robots";
import { STAND_INS } from "../../scene/wallParts";
import { HOLO_H } from "./layout";
import { HOLO_SOURCE, holoFor, holoGeometry, holoNow, resetHolos } from "./robotHolo";

/** A model as the robot GLBs are made: base on y = 0 at the origin, the arm reaching along +x. */
function fakeModel(): THREE.BufferGeometry {
  const base = new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12).translate(0, 0.05, 0);
  const arm = new THREE.BoxGeometry(0.6, 0.06, 0.06).translate(0.35, 0.5, 0);
  const g = new THREE.BufferGeometry();
  const pos = [...base.getAttribute("position").array, ...arm.getAttribute("position").array];
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** The foot's middle: the mean of the lowest few centimetres' vertices. */
function foot(g: THREE.BufferGeometry): { x: number; z: number; n: number } {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const pos = g.getAttribute("position");
  let x = 0;
  let z = 0;
  let n = 0;
  for (let i = 0; i < pos.count; i++)
    if (pos.getY(i) <= b.min.y + 0.04 * HOLO_H) {
      x += pos.getX(i);
      z += pos.getZ(i);
      n++;
    }
  return { x: x / n, z: z / n, n };
}

describe("the robot's hologram on the bench", () => {
  beforeEach(() => resetHolos());

  it("shows each robot's real model, and the Rizon 4 (no model on the site) as the wall's stand-in", () => {
    for (const r of ROBOTS) {
      const src = HOLO_SOURCE[r.code];
      expect(src, r.code).toBeTruthy();
      if ("model" in src) expect(MODEL_IDS, r.code).toContain(src.model);
      else expect(STAND_INS[src.standIn], r.code).toBeTruthy();
    }
    expect(HOLO_SOURCE).toEqual({ S101: { model: "so101" }, FR3: { model: "fr3" }, PPR: { model: "piper" }, RZ4: { standIn: "flexiv" }, OPN: { model: "openarm" } });
  });

  it("stands a model with its foot in the middle of the ring, its largest side the hologram's size", () => {
    const g = holoGeometry(fakeModel());
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(Math.max(b.max.y - b.min.y, b.max.x - b.min.x, b.max.z - b.min.z)).toBeCloseTo(HOLO_H, 6);
    const f = foot(g);
    expect(f.n).toBeGreaterThan(0);
    expect(Math.hypot(f.x, f.z)).toBeLessThan(0.02);
  });

  it("leaves the source geometry as it was", () => {
    const src = fakeModel();
    src.computeBoundingBox();
    const before = src.boundingBox!.clone();
    holoGeometry(src);
    src.computeBoundingBox();
    expect(src.boundingBox!.equals(before)).toBe(true);
  });

  it("loads a model once (the wall's loader), and has it at once after that", async () => {
    const load = vi.fn(async () => fakeModel());
    expect(holoNow("PPR")).toBeNull();
    const a = holoFor("PPR", load);
    const b = holoFor("PPR", load);
    expect(a).toBe(b);
    const g = await a;
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("piper");
    expect(holoNow("PPR")).toBe(g);
    // Its largest side is the hologram's size (this one reaches further than it stands tall).
    const size = new THREE.Vector3();
    g.computeBoundingBox();
    g.boundingBox!.getSize(size);
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(HOLO_H, 6);
  });

  it("builds the stand-in without loading anything", async () => {
    const load = vi.fn(async () => fakeModel());
    const g = await holoFor("RZ4", load);
    expect(load).not.toHaveBeenCalled();
    expect(holoNow("RZ4")).toBe(g);
    const f = foot(g);
    expect(Math.hypot(f.x, f.z)).toBeLessThan(0.02);
  });

  it("tries again after a failed load", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("HTTP 404")).mockResolvedValue(fakeModel());
    await expect(holoFor("OPN", load)).rejects.toThrow(/404/);
    expect(holoNow("OPN")).toBeNull();
    await expect(holoFor("OPN", load)).resolves.toBeInstanceOf(THREE.BufferGeometry);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refuses a robot it has no hologram for", () => {
    expect(() => holoFor("ZZZ")).toThrow(/no hologram/);
  });
});
