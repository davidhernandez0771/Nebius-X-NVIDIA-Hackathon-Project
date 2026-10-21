// A mesh's connected pieces: the triangles that share vertices, joined across vertices that sit at the
// same place (an export splits a vertex where the normals break, or the UVs). Used to cut the robots'
// models into their parts (robotModels.ts) and the machine's model and baked body into theirs
// (machineV2.ts).
import * as THREE from "three";

export interface Piece {
  /** The index of each of its triangles' first corner in the index array (t, t + 1, t + 2). */
  tris: number[];
  box: THREE.Box3;
  centre: THREE.Vector3;
}

/**
 * The connected pieces of an indexed (or not) geometry. `weld` keys the vertices that count as one
 * (default: the position to 0.01 mm); pieces come in no particular order.
 */
export function connectedPieces(g: THREE.BufferGeometry, weld?: (v: number) => string): Piece[] {
  const pos = g.getAttribute("position");
  const n = pos.count;
  const idx = g.index ? (g.index.array as ArrayLike<number>) : [...Array(n).keys()];
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const join = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let t = 0; t < idx.length; t += 3) {
    join(idx[t], idx[t + 1]);
    join(idx[t], idx[t + 2]);
  }
  const key = weld ?? ((v: number) => `${Math.round(pos.getX(v) * 1e5)},${Math.round(pos.getY(v) * 1e5)},${Math.round(pos.getZ(v) * 1e5)}`);
  const at = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const k = key(v);
    const w = at.get(k);
    if (w === undefined) at.set(k, v);
    else join(w, v);
  }
  const byRoot = new Map<number, Piece>();
  const v3 = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(idx[t]);
    let p = byRoot.get(r);
    if (!p) byRoot.set(r, (p = { tris: [], box: new THREE.Box3(), centre: new THREE.Vector3() }));
    p.tris.push(t);
    for (let k = 0; k < 3; k++) p.box.expandByPoint(v3.fromBufferAttribute(pos as never, idx[t + k]));
  }
  // The centre is the mean of its distinct vertices.
  for (const p of byRoot.values()) {
    const seen = new Set<number>();
    for (const t of p.tris) for (let k = 0; k < 3; k++) seen.add(idx[t + k]);
    for (const v of seen) p.centre.add(v3.fromBufferAttribute(pos as never, v));
    p.centre.divideScalar(seen.size);
  }
  return [...byRoot.values()];
}

/** A new geometry of some of `g`'s triangles (their first corners' indices), with the attributes named, compacted. */
export function subGeometry(g: THREE.BufferGeometry, tris: readonly number[], names: readonly string[] = Object.keys(g.attributes)): THREE.BufferGeometry {
  const idx = g.index ? (g.index.array as ArrayLike<number>) : [...Array(g.getAttribute("position").count).keys()];
  const remap = new Map<number, number>();
  const index: number[] = [];
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k];
      let m = remap.get(v);
      if (m === undefined) remap.set(v, (m = remap.size));
      index.push(m);
    }
  const verts = [...remap.keys()];
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(verts.length * a.itemSize);
    verts.forEach((v, i) => {
      for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(v, k);
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  out.setIndex(index);
  return out;
}
