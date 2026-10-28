// The twin's two looks and the wide framing. "hologram" (the default) is the Record page's: a dark matte robot with
// teal edges. "studio" (the test track) reads like a photo of the real arm: the Franka's white links and its dark
// wrist and fingers, under a key light and a rim. And frameScene: a camera that keeps the robot, the cube and the bin
// all in view, rather than the operator's view from behind the arm. Pure, so it is tested.
import type { Vec3 } from "./types";

export type TwinLook = "hologram" | "studio";

/** The Franka's paint, per link (the twin draws one collision mesh per link): white links, a dark wrist flange and
 *  dark fingers. A link not listed is white. */
const DARK_LINKS = new Set(["panda_link7", "panda_link8", "panda_leftfinger", "panda_rightfinger"]);

export function studioTone(link: string | null | undefined): "white" | "dark" {
  return link && DARK_LINKS.has(link) ? "dark" : "white";
}

/** Where the wide camera looks from, relative to what it frames, in the sim's frame (x ahead of the robot, y to its
 *  left, z up): in front of the robot and to its left, raised, so the arm never stands between the camera and the
 *  cube or the bin. */
export const WIDE_DIR: Vec3 = [1, 0.5, 0.8];

/**
 * A camera (sim frame) that fits every point: it looks at the middle of their box, from WIDE_DIR, far enough that a
 * sphere round them fits the narrower of the two fields of view, with `margin` metres to spare.
 */
export function frameScene(points: Vec3[], aspect: number, fovDeg = 38, margin = 0.12, dir: Vec3 = WIDE_DIR): { target: Vec3; position: Vec3 } {
  if (points.length === 0) return { target: [0.4, 0, 0.1], position: [1.6, 0.6, 1.1] };
  const lo = [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i])));
  const target = [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2) as Vec3;
  const radius = Math.max(...points.map((p) => Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]))) + margin;
  const vHalf = ((fovDeg / 2) * Math.PI) / 180;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.1, aspect));
  const dist = radius / Math.sin(Math.min(vHalf, hHalf));
  const n = Math.hypot(...dir);
  return { target, position: [0, 1, 2].map((i) => target[i] + (dir[i] / n) * dist) as Vec3 };
}

/** The sim's frame (z up) to three.js's (y up): (x, y, z) -> (x, z, -y). */
export const toThree = (p: Vec3): Vec3 => [p[0], p[2], -p[1]];
