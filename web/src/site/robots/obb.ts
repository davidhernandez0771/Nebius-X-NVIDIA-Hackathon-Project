// Oriented bounding boxes and a separating-axis overlap test (3 + 3 face normals, 9 edge-edge axes).
// The shelf runs it at layout time so no two cartridges ever intersect.
import { Matrix4, Vector3 } from "three";

export type Obb = { center: Vector3; axes: [Vector3, Vector3, Vector3]; half: [number, number, number] };

/** The box with half extents `half`, centred at `offset` in the local frame of `world` (no scale). */
export function obbFromMatrix(world: Matrix4, half: [number, number, number], offset = new Vector3()): Obb {
  const x = new Vector3(), y = new Vector3(), z = new Vector3();
  world.extractBasis(x, y, z);
  return { center: offset.clone().applyMatrix4(world), axes: [x.normalize(), y.normalize(), z.normalize()], half };
}

function radius(o: Obb, axis: Vector3): number {
  return o.half[0] * Math.abs(o.axes[0].dot(axis)) + o.half[1] * Math.abs(o.axes[1].dot(axis)) + o.half[2] * Math.abs(o.axes[2].dot(axis));
}

/** True when the boxes come closer than `margin` along every axis (so false means at least `margin` of air). */
export function obbOverlap(a: Obb, b: Obb, margin = 0): boolean {
  const d = b.center.clone().sub(a.center);
  const axes: Vector3[] = [...a.axes, ...b.axes];
  for (const u of a.axes) for (const v of b.axes) {
    const c = new Vector3().crossVectors(u, v);
    if (c.lengthSq() > 1e-10) axes.push(c.normalize()); // parallel edges add nothing new
  }
  for (const axis of axes) {
    if (Math.abs(d.dot(axis)) >= radius(a, axis) + radius(b, axis) + margin) return false;
  }
  return true;
}
