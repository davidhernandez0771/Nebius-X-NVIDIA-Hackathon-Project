import { describe, expect, it } from "vitest";
import { frameScene, studioTone, toThree, WIDE_DIR } from "./looks";
import type { Vec3 } from "./types";

const SCENE: Vec3[] = [[0, 0, 0], [0, 0, 0.8], [0.49, -0.15, 0.025], [0.46, 0.29, 0]];

/** The angle (degrees) between the camera's line of sight and the line to p. */
function offAxis(cam: { target: Vec3; position: Vec3 }, p: Vec3): number {
  const a = [0, 1, 2].map((i) => cam.target[i] - cam.position[i]);
  const b = [0, 1, 2].map((i) => p[i] - cam.position[i]);
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (Math.acos(dot / (Math.hypot(...a) * Math.hypot(...b))) * 180) / Math.PI;
}

describe("the studio look", () => {
  it("paints the Franka's links white and its wrist and fingers dark", () => {
    expect(studioTone("panda_link3")).toBe("white");
    expect(studioTone("panda_hand")).toBe("white");
    expect(studioTone("panda_link7")).toBe("dark");
    expect(studioTone("panda_leftfinger")).toBe("dark");
    expect(studioTone(null)).toBe("white");
  });
});

describe("the wide framing", () => {
  it("keeps the robot, the cube and the bin inside the view, at a wide and a narrow pane", () => {
    for (const aspect of [16 / 9, 390 / 380]) {
      const cam = frameScene(SCENE, aspect, 38);
      const half = Math.min(19, (Math.atan(Math.tan((19 * Math.PI) / 180) * aspect) * 180) / Math.PI);
      for (const p of SCENE) expect(offAxis(cam, p)).toBeLessThan(half);
    }
  });

  it("steps back for a narrow pane and looks from the robot's front left, raised", () => {
    const wide = frameScene(SCENE, 16 / 9);
    const narrow = frameScene(SCENE, 0.6);
    const d = (c: { target: Vec3; position: Vec3 }) => Math.hypot(...c.position.map((v, i) => v - c.target[i]));
    expect(d(narrow)).toBeGreaterThan(d(wide));
    const off = wide.position.map((v, i) => v - wide.target[i]);
    expect(off[0]).toBeGreaterThan(0);
    expect(off[1]).toBeGreaterThan(0);
    expect(off[2]).toBeGreaterThan(0);
    expect(off[1] / off[0]).toBeCloseTo(WIDE_DIR[1] / WIDE_DIR[0]);
  });

  it("has a fallback with nothing to frame", () => {
    expect(frameScene([], 1.5).target).toEqual([0.4, 0, 0.1]);
  });

  it("maps the sim's z-up frame to three's y-up one", () => {
    expect(toThree([1, 2, 3])).toEqual([1, 3, -2]);
  });
});
