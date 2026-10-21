// The forest robots' levels of detail, made in code (there is no decimator here): a model's vertices snapped to a
// grid of `cell` metres, each cell's vertices merged into one (their average), and the triangles that collapsed or
// came out twice dropped. And which level each robot is drawn at, by its distance from the camera: the coarse one
// far off, the detailed one up close, both in a band between, where the shader dissolves one into the other.
// Pure, so the tests hold it; robotWrecks.ts builds the forest's robots with it.

export interface LodMesh {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  index: Uint32Array;
}

/** The model with its vertices merged on a grid of `cell` metres (0: the model itself). */
export function clusterLod(m: LodMesh, cell: number): LodMesh {
  if (cell <= 0) return { position: m.position.slice(), normal: m.normal.slice(), color: m.color.slice(), index: m.index.slice() };
  const n = m.position.length / 3;
  const ids = new Map<string, number>();
  const of = new Int32Array(n);
  const sum: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(m.position[i * 3] / cell)},${Math.round(m.position[i * 3 + 1] / cell)},${Math.round(m.position[i * 3 + 2] / cell)}`;
    let v = ids.get(k);
    if (v === undefined) {
      v = ids.size;
      ids.set(k, v);
      sum.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
    of[i] = v;
    const s = v * 10;
    for (let c = 0; c < 3; c++) {
      sum[s + c] += m.position[i * 3 + c];
      sum[s + 3 + c] += m.normal[i * 3 + c];
      sum[s + 6 + c] += m.color[i * 3 + c];
    }
    sum[s + 9]++;
  }
  const count = ids.size;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    const s = v * 10;
    const k = sum[s + 9];
    const len = Math.hypot(sum[s + 3], sum[s + 4], sum[s + 5]) || 1;
    for (let c = 0; c < 3; c++) {
      position[v * 3 + c] = sum[s + c] / k;
      normal[v * 3 + c] = sum[s + 3 + c] / len;
      color[v * 3 + c] = sum[s + 6 + c] / k;
    }
    // Normals that cancelled out (a thin plate's two faces): point it up rather than nowhere.
    if (!Math.hypot(sum[s + 3], sum[s + 4], sum[s + 5])) normal.set([0, 1, 0], v * 3);
  }
  const seen = new Set<string>();
  const index: number[] = [];
  for (let t = 0; t < m.index.length; t += 3) {
    const a = of[m.index[t]], b = of[m.index[t + 1]], c = of[m.index[t + 2]];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((x, y) => x - y).join();
    if (seen.has(key)) continue;
    seen.add(key);
    index.push(a, b, c);
  }
  return { position, normal, color, index: Uint32Array.from(index) };
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
