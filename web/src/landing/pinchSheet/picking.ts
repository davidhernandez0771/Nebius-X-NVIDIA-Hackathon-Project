// Picking math for the pinch sheet: screen point -> ray -> which bit of cloth, and where to drag it.
//
// Pure functions over plain [x, y, z] tuples. The only three.js use is the camera unproject in
// rayFromNdc, which the tests run against a real PerspectiveCamera.

import { Vector3, type Camera } from "three";

export type Vec3 = [number, number, number];
export interface Ray {
  origin: ArrayLike<number>;
  /** Unit length. */
  dir: ArrayLike<number>;
}
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A CSS-pixel point (clientX/Y) to normalized device coordinates of `rect`: -1..1, y up. */
export function clientToNdc(point: { x: number; y: number }, rect: RectLike): { x: number; y: number } | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return {
    x: ((point.x - rect.left) / rect.width) * 2 - 1,
    y: 1 - ((point.y - rect.top) / rect.height) * 2,
  };
}

const tmp = new Vector3();

export function rayFromNdc(ndc: { x: number; y: number }, camera: Camera): { origin: Vec3; dir: Vec3 } {
  const o = new Vector3().setFromMatrixPosition(camera.matrixWorld);
  tmp.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(o).normalize();
  return { origin: [o.x, o.y, o.z], dir: [tmp.x, tmp.y, tmp.z] };
}

/**
 * The particle to grab: of those within `radius` of the ray (and in front of the camera), the one
 * nearest the camera, so a fold on top is grabbed rather than the layer under it. -1 if none.
 */
export function pickParticle(pos: ArrayLike<number>, ray: Ray, radius: number): number {
  const { origin: o, dir: d } = ray;
  const r2 = radius * radius;
  let best = -1;
  let bestT = Infinity;
  for (let i = 0; i < pos.length / 3; i++) {
    const px = pos[i * 3] - o[0];
    const py = pos[i * 3 + 1] - o[1];
    const pz = pos[i * 3 + 2] - o[2];
    const t = px * d[0] + py * d[1] + pz * d[2];
    if (t <= 0) continue;
    const perp2 = px * px + py * py + pz * pz - t * t;
    if (perp2 <= r2 && t < bestT) {
      best = i;
      bestT = t;
    }
  }
  return best;
}

export function intersectRayPlane(ray: Ray, point: ArrayLike<number>, normal: ArrayLike<number>): Vec3 | null {
  const { origin: o, dir: d } = ray;
  const denom = d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2];
  if (Math.abs(denom) < 1e-9) return null;
  const t =
    ((point[0] - o[0]) * normal[0] + (point[1] - o[1]) * normal[1] + (point[2] - o[2]) * normal[2]) / denom;
  if (t < 0) return null;
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}

export function clampToSphere(p: ArrayLike<number>, center: ArrayLike<number>, r: number): Vec3 {
  const dx = p[0] - center[0];
  const dy = p[1] - center[1];
  const dz = p[2] - center[2];
  const len = Math.hypot(dx, dy, dz);
  if (len <= r || len === 0) return [p[0], p[1], p[2]];
  const k = r / len;
  return [center[0] + dx * k, center[1] + dy * k, center[2] + dz * k];
}

export interface DragTargetInput {
  ray: Ray;
  /** A point on the drag plane: where the cloth was grabbed. */
  planePoint: ArrayLike<number>;
  /** Unit vector from the plane toward the camera; also the plane's normal. */
  towardCamera: ArrayLike<number>;
  /** How far the held point is lifted off the plane toward the viewer, like a pinch raising fabric. */
  lift: number;
  /** The held particle's rest position, and how far from it it may be pulled. */
  rest: ArrayLike<number>;
  maxPull: number;
}

/** Where the held point should go: the pointer on the grab plane, lifted, kept within reach. */
export function dragTarget(input: DragTargetInput): Vec3 | null {
  const hit = intersectRayPlane(input.ray, input.planePoint, input.towardCamera);
  if (!hit) return null;
  const n = input.towardCamera;
  const lifted: Vec3 = [hit[0] + n[0] * input.lift, hit[1] + n[1] * input.lift, hit[2] + n[2] * input.lift];
  return clampToSphere(lifted, input.rest, input.maxPull);
}

/**
 * Camera distance at which a width x height sheet, grown by `margin` (0.2 = 20% extra), fits a
 * perspective view with vertical field of view `fovDeg` and the given aspect (width / height).
 */
export function fitDistance(fovDeg: number, aspect: number, width: number, height: number, margin: number): number {
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  const k = 1 + margin;
  const byHeight = (height * k) / 2 / tanHalf;
  const byWidth = (width * k) / 2 / (tanHalf * aspect);
  return Math.max(byHeight, byWidth);
}
