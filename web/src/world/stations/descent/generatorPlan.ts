// The transition's particles, like Active Theory's "generator" (a sculpture forming out of glittering
// particles inside its cage): the ring bursts into a cloud that fills the dark, then every particle
// streams onto a point of the workshop's surfaces and takes that surface's colour, so the room is built
// out of light before the real one materializes over it (scene/dissolve.ts). The targets are sampled
// from the baked GLBs themselves (room.glb and the furniture), plus boxes for the cartridges on the
// spiral and the library shelves, which aren't baked. Pure: the sampling, the budget and the timing
// (which the vertex shader in Generator.tsx mirrors) are tested.
import type { TierName } from "../../core/quality";
import type { Quat } from "../../scene/layout";

/** Particles per tier: desktop 100–150k, low (and phones) 20–30k. */
export const POINTS: Record<TierName, number> = { low: 24000, high: 110000, ultra: 150000 };

/** Where the particles go, as shares of the budget. The room is most of the area, but the furniture and the cartridges carry the shapes. */
export const SHARES = {
  room: 0.42,
  shelves: 0.12,
  library: 0.07,
  pedestal: 0.05,
  bench: 0.09,
  desk: 0.05,
  machine_body: 0.09,
  helix: 0.11,
} as const;

export type Piece = keyof typeof SHARES;

/** Integer counts per piece that add up to exactly n (largest remainders get the leftovers). */
export function splitBudget<K extends string>(n: number, shares: Record<K, number>): Record<K, number> {
  const keys = Object.keys(shares) as K[];
  const raw = keys.map((k) => n * shares[k]);
  const out = Object.fromEntries(keys.map((k, i) => [k, Math.floor(raw[i])])) as Record<K, number>;
  let left = n - keys.reduce((s, k) => s + out[k], 0);
  const order = keys.map((k, i) => [k, raw[i] - Math.floor(raw[i])] as const).sort((a, b) => b[1] - a[1]);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i][0]]++;
  return out;
}

export interface MeshData {
  position: ArrayLike<number>;
  index: ArrayLike<number> | null;
  uv: ArrayLike<number> | null;
}

/** n points spread over a triangle mesh by area, with the uv at each (zeros without uvs). */
export function sampleTriangles(mesh: MeshData, n: number, rnd: () => number): { position: Float32Array; uv: Float32Array } {
  const { position: P, index: I, uv: U } = mesh;
  const tris = I ? I.length / 3 : P.length / 9;
  const vi = (t: number, k: number) => (I ? I[t * 3 + k] : t * 3 + k);
  const cum = new Float64Array(tris);
  let total = 0;
  for (let t = 0; t < tris; t++) {
    const a = vi(t, 0) * 3;
    const b = vi(t, 1) * 3;
    const c = vi(t, 2) * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    total += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    cum[t] = total;
  }
  const position = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    // The triangle: binary search on the running area.
    const r = rnd() * total;
    let lo = 0;
    let hi = tris - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    // A uniform point on it.
    let s = rnd();
    let q = rnd();
    if (s + q > 1) {
      s = 1 - s;
      q = 1 - q;
    }
    const w0 = 1 - s - q;
    const [a, b, c] = [vi(lo, 0), vi(lo, 1), vi(lo, 2)];
    for (let k = 0; k < 3; k++) position[i * 3 + k] = P[a * 3 + k] * w0 + P[b * 3 + k] * s + P[c * 3 + k] * q;
    if (U) for (let k = 0; k < 2; k++) uv[i * 2 + k] = U[a * 2 + k] * w0 + U[b * 2 + k] * s + U[c * 2 + k] * q;
  }
  return { position, uv };
}

/** v rotated by the quaternion q (x, y, z, w). */
function rotate([x, y, z]: readonly number[], [qx, qy, qz, qw]: Quat): [number, number, number] {
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

/** n points on the surface of a box (half sizes `half`), centred at `c` and turned by `q`, by face area. */
export function sampleBox(c: readonly number[], q: Quat, half: readonly [number, number, number], n: number, rnd: () => number): Float32Array {
  const [hx, hy, hz] = half;
  const areas = [hy * hz, hx * hz, hx * hy];
  const sum = areas[0] + areas[1] + areas[2];
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = rnd() * sum;
    const axis = r < areas[0] ? 0 : r < areas[0] + areas[1] ? 1 : 2;
    const local: [number, number, number] = [(rnd() * 2 - 1) * hx, (rnd() * 2 - 1) * hy, (rnd() * 2 - 1) * hz];
    local[axis] = (rnd() < 0.5 ? -1 : 1) * half[axis];
    const w = rotate(local, q);
    out[i * 3] = c[0] + w[0];
    out[i * 3 + 1] = c[1] + w[1];
    out[i * 3 + 2] = c[2] + w[2];
  }
  return out;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** 0–1: a particle (its random `r`) leaving the ring for the cloud, over the descent's t. */
export function burstAt(t: number, r: number): number {
  return smooth(0.02 + 0.05 * r, 0.22 + 0.1 * r, t);
}

/** 0–1: a particle streaming onto its target; `h` is the target's height 0 (floor) to 1 (ceiling). */
export function convergeAt(t: number, r: number, h: number): number {
  const c = 0.55 * r + 0.45 * h;
  return smooth(0.34 + 0.32 * c, 0.62 + 0.32 * c, t);
}

/** The target's height 0–1, as the shader computes it (the floor at -0.6, the ceiling at 14.4). */
export const heightOf = (y: number) => clamp01((y + 0.6) / 15);
