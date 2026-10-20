// The stations' camera poses are framed for landscape screens: a fixed vertical field of view. A phone
// held upright then sees a sliver across (19° at 40° vertical on 390×844), so the logo ran off the sides
// and the hub showed only the shelf. Here a portrait screen gets a taller field of view, so it sees as
// much across as a square screen would, up to MAX_FOV (past that the perspective distorts).

export const MAX_FOV = 80;

/** The vertical field of view (degrees) to draw `fov` with at `aspect` (width / height). */
export function fitFov(fov: number, aspect: number): number {
  if (!(aspect < 1)) return fov;
  const half = Math.atan(Math.tan((fov * Math.PI) / 360) / aspect);
  return Math.min(MAX_FOV, (half * 360) / Math.PI);
}
