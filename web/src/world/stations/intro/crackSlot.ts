// The crack in the forest floor, as a slot a Blender model can fill (Crack.tsx). The procedural crack is a lens cut
// out of the floor (forestPlan.ts crackHalfWidth, mirrored in the floor's shader) with a fissure carried straight
// down through the rock. A model dropped in at CRACK_SLOT.url replaces the fissure and the lip; the floor keeps
// cutting the same lens, so the model's opening must fit inside it (or the lens can be widened to match it).
//
// The model's frame: origin on the crack's centre at floor level, +x along the crack (its length 2 x halfLength),
// +z across it, +y up; the fissure goes down to y = -depth, where the reactor cavern's ceiling is. Metres.
import type { Vec3 } from "../../core/types";
import { CRACK, FOREST, ROCK } from "./layout";

export const CRACK_SLOT = {
  /** Under web/public; absent until the Blender crack is exported. */
  url: "world/models/crack.glb",
  halfLength: CRACK.halfLength,
  halfWidth: CRACK.halfWidth,
  /** From the forest floor down to the cavern's ceiling (m). */
  depth: ROCK.top - ROCK.bottom,
} as const;

const DIR = [Math.cos(CRACK.angle), -Math.sin(CRACK.angle)] as const;
const ACROSS = [Math.sin(CRACK.angle), Math.cos(CRACK.angle)] as const;

/** A point in the model's frame -> the world. */
export function crackToWorld([x, y, z]: Vec3): [number, number, number] {
  return [CRACK.center[0] + x * DIR[0] + z * ACROSS[0], FOREST.floor + y, CRACK.center[1] + x * DIR[1] + z * ACROSS[1]];
}

/** The model frame's rotation about y (rad), for a three.js Object3D: its +x turned onto the crack's direction. */
export const CRACK_YAW = CRACK.angle;

/** Whether the bytes are a binary glTF 2 file (magic "glTF", version 2). A dev server answers a missing file with
 *  its index.html and a 200, so the status alone can't tell. */
export function isGlb(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 12) return false;
  const v = new DataView(bytes);
  return v.getUint32(0, true) === 0x46546c67 && v.getUint32(4, true) === 2;
}

/** A model's triangles reordered top first (by each one's highest point), and how many indices belong to those
 *  reaching above `cutoff` (m, the model's frame): from the forest the camera sees only the top of the crack, so
 *  the walk draws that prefix and the fall draws them all. */
export function depthOrder(index: ArrayLike<number>, position: ArrayLike<number>, cutoff: number): { index: Uint32Array; above: number } {
  const n = index.length / 3;
  const top = new Float32Array(n);
  for (let t = 0; t < n; t++) top[t] = Math.max(position[index[t * 3] * 3 + 1], position[index[t * 3 + 1] * 3 + 1], position[index[t * 3 + 2] * 3 + 1]);
  const order = Array.from({ length: n }, (_, t) => t).sort((a, b) => top[b] - top[a]);
  const out = new Uint32Array(n * 3);
  let above = 0;
  order.forEach((t, k) => {
    out.set([index[t * 3], index[t * 3 + 1], index[t * 3 + 2]], k * 3);
    if (top[t] > cutoff) above += 3;
  });
  return { index: out, above };
}
