import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { ITEM_SIZE, robotSpot } from "../../scene/wallPlan";
import { CATALOG } from "./catalog";
import robots, { ROBOTS_VIEW } from "./index";

function project(p: readonly number[], aspect: number) {
  const cam = new PerspectiveCamera(ROBOTS_VIEW.fov, aspect, 0.1, 200);
  cam.position.set(...(ROBOTS_VIEW.position as [number, number, number]));
  cam.lookAt(...(ROBOTS_VIEW.target as [number, number, number]));
  cam.updateMatrixWorld();
  return new Vector3(...(p as [number, number, number])).project(cam);
}

describe("the robots view", () => {
  it("is a branch off the room view, with the room's still for the 2D fallback", () => {
    expect(robots.kind).toBe("branch");
    expect(robots.still).toMatch(/workshop\.webp$/);
    expect(robots.camera(0)).toEqual(ROBOTS_VIEW);
  });

  it("turns to the left wall", () => {
    const [px, , pz] = ROBOTS_VIEW.position;
    const [tx, , tz] = ROBOTS_VIEW.target;
    expect(tx).toBeLessThan(px);
    expect(Math.abs(tz - pz)).toBeLessThan(0.5);
  });

  // On a landscape screen the catalog panel takes the left 39% and the journey rail the right edge:
  // every robot, top to bottom and edge to edge, stands between them.
  it("frames all five robots between the panel and the journey rail on a 16:9 screen", () => {
    for (const r of CATALOG) {
      const { position, height } = robotSpot(r.id);
      const half = ITEM_SIZE.robot.width / 2;
      for (const dz of [-half, half])
        for (const dy of [0, height]) {
          const p = project([position[0], position[1] + dy, position[2] + dz], 16 / 9);
          expect(p.x).toBeGreaterThan(-0.2);
          expect(p.x).toBeLessThan(0.8);
          expect(Math.abs(p.y)).toBeLessThan(0.9);
        }
    }
  });
});
