import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ROBOTS } from "../../scene/robots";
import { STAND_INS, standIn } from "../../scene/wallParts";
import { HOLO_H } from "./layout";
import { HOLO_SOURCE, holoGeometry, robotHoloGeometry } from "./robotHolo";

describe("the robot's hologram on the bench", () => {
  it("has a model for every robot the bench offers: the twin's Franka, or the robot wall's stand-in", () => {
    for (const r of ROBOTS) {
      const src = HOLO_SOURCE[r.code];
      expect(src, r.code).toBeTruthy();
      if (src !== "franka") expect(STAND_INS[src], r.code).toBeTruthy();
    }
    expect(HOLO_SOURCE.FR3).toBe("franka");
  });

  it("stands each one with its foot in the middle of the ring, its largest side the hologram's size", () => {
    for (const r of ROBOTS) {
      if (HOLO_SOURCE[r.code] === "franka") continue;
      const g = robotHoloGeometry(r.code, null)!;
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.y).toBeCloseTo(0, 6);
      expect(Math.max(b.max.y - b.min.y, b.max.x - b.min.x, b.max.z - b.min.z)).toBeCloseTo(HOLO_H, 6);
      // The foot (its lowest few centimetres) is centred on the ring, wherever the arm reaches.
      const pos = g.getAttribute("position");
      let fx = 0;
      let fz = 0;
      let n = 0;
      for (let i = 0; i < pos.count; i++)
        if (pos.getY(i) <= b.min.y + 0.04 * HOLO_H) {
          fx += pos.getX(i);
          fz += pos.getZ(i);
          n++;
        }
      expect(n).toBeGreaterThan(0);
      expect(Math.hypot(fx / n, fz / n)).toBeLessThan(0.02);
    }
  });

  it("waits for the Franka's meshes, and leaves the source geometry as it was", () => {
    expect(robotHoloGeometry("FR3", null)).toBeNull();
    const src = standIn("piper");
    src.computeBoundingBox();
    const before = src.boundingBox!.clone();
    holoGeometry(src);
    src.computeBoundingBox();
    expect(src.boundingBox!.equals(before)).toBe(true);
    const arm = new THREE.BoxGeometry(0.4, 1, 0.2);
    const g = robotHoloGeometry("FR3", arm)!;
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeCloseTo(HOLO_H, 6);
  });
});
