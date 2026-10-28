// The forest robots' lower levels of detail: each model simplified to a triangle budget by edge collapse with
// quadric error (Garland & Heckbert), the way a mesh decimator does it, so the shape holds where it matters (corners,
// edges, the arm's silhouette) and flat runs give up their triangles first. Then the normals are made again, split
// at hard edges (over CREASE_DEG) and smooth across curves, so the shading reads as the robot's panels and not as the
// mush of averaged normals the old grid snap left (robotLod.ts history). Each part keeps its own colour: vertices are
// welded by position and colour, so a white shell and a dark joint never collapse into each other.
// Pure and deterministic, so the tests (and the budget test, on the real GLBs) hold it.
import type { LodMesh } from "./robotLod";

/** Faces meeting at more than this angle keep separate normals (a hard edge); below it they are smoothed. */
export const CREASE_DEG = 55;
/** How strongly an open edge (a part's rim) resists moving off its line, against the surface's own error. */
const BOUNDARY_W = 8;

/** A plane's quadric (a, b, c, d) scaled by w, added into q at offset o (10 floats: the upper triangle). */
function addPlane(q: Float64Array, o: number, a: number, b: number, c: number, d: number, w: number) {
  q[o] += w * a * a; q[o + 1] += w * a * b; q[o + 2] += w * a * c; q[o + 3] += w * a * d;
  q[o + 4] += w * b * b; q[o + 5] += w * b * c; q[o + 6] += w * b * d;
  q[o + 7] += w * c * c; q[o + 8] += w * c * d; q[o + 9] += w * d * d;
}

const quadError = (q: number[], x: number, y: number, z: number) =>
  q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];

/** A min-heap of edge candidates, by cost (ties by insertion order, so the result is deterministic). */
class Heap {
  private cost: number[] = [];
  private seq: number[] = [];
  private item: number[] = [];
  private n = 0;
  get size() {
    return this.n;
  }
  private less(i: number, j: number) {
    return this.cost[i] < this.cost[j] || (this.cost[i] === this.cost[j] && this.seq[i] < this.seq[j]);
  }
  private swap(i: number, j: number) {
    [this.cost[i], this.cost[j]] = [this.cost[j], this.cost[i]];
    [this.seq[i], this.seq[j]] = [this.seq[j], this.seq[i]];
    [this.item[i], this.item[j]] = [this.item[j], this.item[i]];
  }
  push(cost: number, seq: number, item: number) {
    let i = this.n++;
    this.cost[i] = cost;
    this.seq[i] = seq;
    this.item[i] = item;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.item[0];
    this.n--;
    if (this.n > 0) {
      this.cost[0] = this.cost[this.n];
      this.seq[0] = this.seq[this.n];
      this.item[0] = this.item[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/** The model welded: one vertex per position and colour (GLBs split vertices wherever their normals or uvs change). */
function weld(m: LodMesh): { P: Float64Array; col: number[]; faces: number[]; nv: number } {
  const ids = new Map<string, number>();
  const pos: number[] = [];
  const col: number[] = [];
  const of = new Int32Array(m.position.length / 3);
  for (let i = 0; i < of.length; i++) {
    const p = m.position, c = m.color;
    const k = `${Math.round(p[i * 3] * 1e5)},${Math.round(p[i * 3 + 1] * 1e5)},${Math.round(p[i * 3 + 2] * 1e5)},${Math.round(c[i * 3] * 255)},${Math.round(c[i * 3 + 1] * 255)},${Math.round(c[i * 3 + 2] * 255)}`;
    let v = ids.get(k);
    if (v === undefined) {
      v = ids.size;
      ids.set(k, v);
      pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      col.push(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]);
    }
    of[i] = v;
  }
  const faces: number[] = [];
  const seenFace = new Set<string>();
  for (let t = 0; t < m.index.length; t += 3) {
    const a = of[m.index[t]], b = of[m.index[t + 1]], c = of[m.index[t + 2]];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((x, y) => x - y).join();
    if (seenFace.has(key)) continue;
    seenFace.add(key);
    faces.push(a, b, c);
  }
  return { P: Float64Array.from(pos), col, faces, nv: ids.size };
}

/**
 * The share of the welded model's edges that are open (one face). A clean model is near 0; an export that is a
 * triangle soup (cracks and T-junctions everywhere) is most of the way to 1, and no edge collapse can simplify it
 * without slivers: such a model is drawn as it is (robotWrecks.ts robotLevels).
 */
export function openEdgeShare(m: LodMesh): number {
  const { faces, nv } = weld(m);
  const count = new Map<number, number>();
  for (let f = 0; f < faces.length; f += 3)
    for (let k = 0; k < 3; k++) {
      const a = faces[f + k], b = faces[f + ((k + 1) % 3)];
      const e = a < b ? a * nv + b : b * nv + a;
      count.set(e, (count.get(e) ?? 0) + 1);
    }
  let open = 0;
  for (const c of count.values()) if (c === 1) open++;
  return count.size ? open / count.size : 0;
}

export interface SimplifyOptions {
  /**
   * When the manifold-safe collapses stall short of the target, go on without the link condition (only the guard
   * against flipped or crushed faces). Reaches any target, at the cost of fins on messy meshes; off by default.
   */
  relaxed?: boolean;
}

/** The model simplified to at most `target` triangles (the model itself when it has no more than that). */
export function simplifyLod(m: LodMesh, target: number, opts: SimplifyOptions = {}): LodMesh {
  if (m.index.length / 3 <= target) return { position: m.position.slice(), normal: m.normal.slice(), color: m.color.slice(), index: m.index.slice() };
  const { P, col, faces, nv } = weld(m);
  const F = Int32Array.from(faces);
  const nf = F.length / 3;
  const alive = new Uint8Array(nf).fill(1);
  let live = nf;

  // Each vertex's faces, and the quadric of the planes round it (area-weighted).
  const vFaces: number[][] = Array.from({ length: nv }, () => []);
  const Q = new Float64Array(nv * 10);
  const edgeCount = new Map<number, number>();
  const ek = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
  for (let f = 0; f < nf; f++) {
    const [a, b, c] = [F[f * 3], F[f * 3 + 1], F[f * 3 + 2]];
    vFaces[a].push(f);
    vFaces[b].push(f);
    vFaces[c].push(f);
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len; ny /= len; nz /= len;
      const d = -(nx * P[a * 3] + ny * P[a * 3 + 1] + nz * P[a * 3 + 2]);
      for (const v of [a, b, c]) addPlane(Q, v * 10, nx, ny, nz, d, len / 2);
    }
    for (const [x, y] of [[a, b], [b, c], [c, a]]) edgeCount.set(ek(x, y), (edgeCount.get(ek(x, y)) ?? 0) + 1);
  }
  // Open edges (a part's rim): a plane through the edge, upright on its face, so the rim keeps its line.
  for (let f = 0; f < nf; f++) {
    const v = [F[f * 3], F[f * 3 + 1], F[f * 3 + 2]];
    const ux = P[v[1] * 3] - P[v[0] * 3], uy = P[v[1] * 3 + 1] - P[v[0] * 3 + 1], uz = P[v[1] * 3 + 2] - P[v[0] * 3 + 2];
    const wx = P[v[2] * 3] - P[v[0] * 3], wy = P[v[2] * 3 + 1] - P[v[0] * 3 + 1], wz = P[v[2] * 3 + 2] - P[v[0] * 3 + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const fl = Math.hypot(fx, fy, fz);
    if (!fl) continue;
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3];
      if (edgeCount.get(ek(a, b)) !== 1) continue;
      const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], ez = P[b * 3 + 2] - P[a * 3 + 2];
      let px = ey * fz - ez * fy, py = ez * fx - ex * fz, pz = ex * fy - ey * fx;
      const pl = Math.hypot(px, py, pz);
      if (!pl) continue;
      px /= pl; py /= pl; pz /= pl;
      const d = -(px * P[a * 3] + py * P[a * 3 + 1] + pz * P[a * 3 + 2]);
      const w = BOUNDARY_W * (ex * ex + ey * ey + ez * ez);
      addPlane(Q, a * 10, px, py, pz, d, w);
      addPlane(Q, b * 10, px, py, pz, d, w);
    }
  }

  // Edge candidates: the collapse of (a, b) to its best point, by the summed quadric's error there.
  const version = new Int32Array(nv);
  const vAlive = new Uint8Array(nv).fill(1);
  const cand: { a: number; b: number; va: number; vb: number; x: number; y: number; z: number }[] = [];
  const heap = new Heap();
  let seq = 0;
  const q = new Array<number>(10);
  const consider = (a: number, b: number) => {
    for (let i = 0; i < 10; i++) q[i] = Q[a * 10 + i] + Q[b * 10 + i];
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    const opts: [number, number, number][] = [[ax, ay, az], [bx, by, bz], [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]];
    // The optimum, where it is well defined and stays near the edge.
    const det = q[0] * (q[4] * q[7] - q[5] * q[5]) - q[1] * (q[1] * q[7] - q[5] * q[2]) + q[2] * (q[1] * q[5] - q[4] * q[2]);
    if (Math.abs(det) > 1e-12) {
      const r0 = -q[3], r1 = -q[6], r2 = -q[8];
      const x = (r0 * (q[4] * q[7] - q[5] * q[5]) - q[1] * (r1 * q[7] - q[5] * r2) + q[2] * (r1 * q[5] - q[4] * r2)) / det;
      const y = (q[0] * (r1 * q[7] - r2 * q[5]) - r0 * (q[1] * q[7] - q[5] * q[2]) + q[2] * (q[1] * r2 - r1 * q[2])) / det;
      const z = (q[0] * (q[4] * r2 - q[5] * r1) - q[1] * (q[1] * r2 - r1 * q[2]) + r0 * (q[1] * q[5] - q[4] * q[2])) / det;
      const el = Math.hypot(bx - ax, by - ay, bz - az);
      if (Math.hypot(x - (ax + bx) / 2, y - (ay + by) / 2, z - (az + bz) / 2) < el) opts.push([x, y, z]);
    }
    let best = opts[0], cost = Infinity;
    for (const o of opts) {
      const e = quadError(q, o[0], o[1], o[2]);
      if (e < cost - 1e-18) {
        cost = e;
        best = o;
      }
    }
    cand.push({ a, b, va: version[a], vb: version[b], x: best[0], y: best[1], z: best[2] });
    heap.push(Math.max(0, cost), seq++, cand.length - 1);
  };
  for (const key of [...edgeCount.keys()].sort((x, y) => x - y)) consider(Math.floor(key / nv), key % nv);

  const facesOf = (v: number) => (vFaces[v] = vFaces[v].filter((f) => alive[f]));
  const neighbours = (v: number) => {
    const s = new Set<number>();
    for (const f of facesOf(v)) for (let k = 0; k < 3; k++) if (F[f * 3 + k] !== v) s.add(F[f * 3 + k]);
    return s;
  };
  // Would moving v to (x, y, z) flip or crush any of its faces that survive the collapse (those without `other`)?
  const flips = (v: number, other: number, x: number, y: number, z: number) => {
    for (const f of vFaces[v]) {
      const t = [F[f * 3], F[f * 3 + 1], F[f * 3 + 2]];
      if (t.includes(other)) continue;
      const p = t.map((i) => (i === v ? [x, y, z] : [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]));
      const o = t.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
      const n = (s: number[][]) => {
        const ux = s[1][0] - s[0][0], uy = s[1][1] - s[0][1], uz = s[1][2] - s[0][2];
        const wx = s[2][0] - s[0][0], wy = s[2][1] - s[0][1], wz = s[2][2] - s[0][2];
        return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
      };
      const a = n(o), b = n(p);
      const la = Math.hypot(a[0], a[1], a[2]), lb = Math.hypot(b[0], b[1], b[2]);
      if (lb < la * 1e-3 || lb === 0) return true;
      if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0.25 * la * lb) return true;
    }
    return false;
  };

  // The first pass keeps the surface manifold (the link condition) and may stall short of the target on a messy
  // mesh; with opts.relaxed a second pass lets the link condition go and keeps only the guard against flipped or
  // crushed faces.
  for (let pass = 0; pass < (opts.relaxed ? 2 : 1) && live > target; pass++) {
    if (pass) {
      const edges = new Set<number>();
      for (let f = 0; f < nf; f++) if (alive[f]) for (let k = 0; k < 3; k++) edges.add(ek(F[f * 3 + k], F[f * 3 + ((k + 1) % 3)]));
      for (const key of [...edges].sort((x, y) => x - y)) consider(Math.floor(key / nv), key % nv);
    }
    while (live > target && heap.size) {
      const c = cand[heap.pop()];
      const { a, b } = c;
      if (!vAlive[a] || !vAlive[b] || c.va !== version[a] || c.vb !== version[b]) continue;
      facesOf(a);
      facesOf(b);
      // The link condition: a and b may share only the neighbours of the faces on their edge (no pinched fins).
      const shared = vFaces[a].filter((f) => F[f * 3] === b || F[f * 3 + 1] === b || F[f * 3 + 2] === b).length;
      if (!shared) continue;
      if (!pass) {
        const nb = neighbours(b);
        let common = 0;
        for (const n of neighbours(a)) if (nb.has(n)) common++;
        if (common > shared) continue;
      }
      if (flips(a, b, c.x, c.y, c.z) || flips(b, a, c.x, c.y, c.z)) continue;
      // Collapse b into a, at the edge's best point.
      P[a * 3] = c.x;
      P[a * 3 + 1] = c.y;
      P[a * 3 + 2] = c.z;
      for (let i = 0; i < 10; i++) Q[a * 10 + i] += Q[b * 10 + i];
      for (const f of vFaces[b]) {
        if (F[f * 3] === a || F[f * 3 + 1] === a || F[f * 3 + 2] === a) {
          alive[f] = 0;
          live--;
          continue;
        }
        for (let k = 0; k < 3; k++) if (F[f * 3 + k] === b) F[f * 3 + k] = a;
        vFaces[a].push(f);
      }
      vAlive[b] = 0;
      vFaces[b] = [];
      version[a]++;
      for (const n of [...neighbours(a)].sort((x, y) => x - y)) consider(a, n);
    }
  }

  // Normals again: each corner takes the faces round its vertex that meet its own face under the crease angle.
  const fn = new Float64Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    if (!alive[f]) continue;
    const [a, b, c] = [F[f * 3], F[f * 3 + 1], F[f * 3 + 2]];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
    fn[f * 3] = uy * wz - uz * wy;
    fn[f * 3 + 1] = uz * wx - ux * wz;
    fn[f * 3 + 2] = ux * wy - uy * wx;
  }
  const cosCrease = Math.cos((CREASE_DEG * Math.PI) / 180);
  const unit = (f: number) => {
    const l = Math.hypot(fn[f * 3], fn[f * 3 + 1], fn[f * 3 + 2]) || 1;
    return [fn[f * 3] / l, fn[f * 3 + 1] / l, fn[f * 3 + 2] / l];
  };
  const outPos: number[] = [];
  const outNor: number[] = [];
  const outCol: number[] = [];
  const outIdx: number[] = [];
  const corner = new Map<string, number>();
  for (let f = 0; f < nf; f++) {
    if (!alive[f]) continue;
    const nf0 = unit(f);
    for (let k = 0; k < 3; k++) {
      const v = F[f * 3 + k];
      let sx = 0, sy = 0, sz = 0;
      for (const g of facesOf(v)) {
        const ng = unit(g);
        if (nf0[0] * ng[0] + nf0[1] * ng[1] + nf0[2] * ng[2] < cosCrease) continue;
        sx += fn[g * 3];
        sy += fn[g * 3 + 1];
        sz += fn[g * 3 + 2];
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      const nx = sx / l, ny = sy / l, nz = sz / l;
      const key = `${v},${Math.round(nx * 500)},${Math.round(ny * 500)},${Math.round(nz * 500)}`;
      let o = corner.get(key);
      if (o === undefined) {
        o = corner.size;
        corner.set(key, o);
        outPos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        outNor.push(nx, ny, nz);
        outCol.push(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]);
      }
      outIdx.push(o);
    }
  }
  return { position: new Float32Array(outPos), normal: new Float32Array(outNor), color: new Float32Array(outCol), index: Uint32Array.from(outIdx) };
}

/** Above this share of open edges a model is a triangle soup (openEdgeShare): simplified only down to SOUP_FLOOR. */
export const SOUP = 0.15;
/** A soup's single level: its cracks show as slivers when collapsed further (the OpenArm export holds up at this). */
export const SOUP_FLOOR = 6000;

/** A robot's levels: far (coarse) and, where the tier has one, near (detail). */
export interface RobotLevels {
  coarse: LodMesh;
  detail?: LodMesh;
}

/**
 * The levels a tier draws a model at: the coarse one simplified to the tier's far budget, the detailed one to its near
 * budget (the model itself when the budget is at least its size). A triangle soup gets one level, no coarser than
 * SOUP_FLOOR. robotLevels.worker.ts runs this off the main thread.
 */
export function robotLevels(model: LodMesh, tier: { coarse: number; detail: number; near: number }): RobotLevels {
  if (openEdgeShare(model) > SOUP) return { coarse: simplifyLod(model, Math.max(tier.coarse, SOUP_FLOOR)) };
  return { coarse: simplifyLod(model, tier.coarse), detail: tier.near > 0 && tier.detail > 0 ? simplifyLod(model, tier.detail) : undefined };
}
