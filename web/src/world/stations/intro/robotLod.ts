// The forest robots' levels of detail: which level each robot is drawn at, by its distance from the camera (the
// coarse one far off, the detailed one up close, both in a band between, where the shader dissolves one into the
// other), and the index list that draws them. The levels themselves are made by robotSimplify.ts (edge collapse
// to a triangle budget). Pure, so the tests hold it; robotWrecks.ts builds the forest's robots with it.

export interface LodMesh {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  index: Uint32Array;
}

export interface LodTier {
  /** Within this distance (m) of the camera a robot is drawn in detail (0: never). */
  near: number;
  /** Over this last stretch inside `near` the two levels dissolve into each other (m). */
  band: number;
}

export interface Levels {
  coarse: boolean;
  detail: boolean;
}

/** The levels a robot this far from the camera is drawn at. */
export function lodLevels(distance: number, t: LodTier): Levels {
  if (t.near <= 0) return { coarse: true, detail: false };
  return { coarse: distance >= t.near - t.band, detail: distance < t.near };
}

/** Each robot's span in the merged index list ([start, end) in indices), per level. */
export interface Ranges {
  coarse: [number, number][];
  detail: [number, number][];
}

/** The chosen robots' triangles, copied from `all` into `out`, coarse ones first; returns how many indices. */
export function packIndices(all: Uint32Array, ranges: Ranges, levels: readonly Levels[], out: Uint32Array): number {
  let n = 0;
  const copy = ([a, b]: [number, number]) => {
    out.set(all.subarray(a, b), n);
    n += b - a;
  };
  levels.forEach((l, i) => l.coarse && copy(ranges.coarse[i]));
  levels.forEach((l, i) => l.detail && copy(ranges.detail[i]));
  return n;
}
