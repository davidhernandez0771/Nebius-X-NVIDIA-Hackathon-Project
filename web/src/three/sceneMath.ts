export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** smoothstep from a to b */
export const seg = (x: number, a: number, b: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type V3 = [number, number, number];

interface CamKey {
  pos: V3;
  target: V3;
  /** -1..1: which side of the screen the room sits on (text goes opposite) */
  side: number;
  /** fraction of screen height to raise (+) or lower (-) the room */
  lift: number;
}

// One key per chapter. The camera holds while the copy is pinned, then moves.
export const CAM: CamKey[] = [
  { pos: [7.0, 4.4, 8.4], target: [0, 0.9, 0], side: 1, lift: 0 }, // intro
  { pos: [7.0, 4.4, 8.2], target: [0, 0.9, 0], side: -1, lift: 0 }, // scan
  { pos: [9.0, 5.6, 11.4], target: [0, 1.5, 0], side: 1, lift: 0 }, // photograph (exploded)
  { pos: [9.6, 4.8, 11.2], target: [0, 1.7, 0], side: -1.55, lift: 0 }, // review
  { pos: [5.6, 3.2, 7.2], target: [-0.5, 1.0, -0.6], side: 1, lift: 0 }, // organize
  { pos: [6.2, 3.4, 8.2], target: [0.3, 0.9, -0.2], side: 0, lift: 0.2 }, // ask
  { pos: [11.6, 6.6, 14.6], target: [0, 1.0, 0], side: 0, lift: -0.24 }, // enter
];
export function sampleCamera(c: number) {
  const n = CAM.length - 1;
  const cc = Math.min(Math.max(c, 0), n);
  const i = Math.min(Math.floor(cc), n - 1);
  const t = seg(cc - i, 0.3, 0.95);
  const a = CAM[i];
  const b = CAM[i + 1];
  const mix = (u: V3, v: V3): V3 => [lerp(u[0], v[0], t), lerp(u[1], v[1], t), lerp(u[2], v[2], t)];
  return {
    pos: mix(a.pos, b.pos),
    target: mix(a.target, b.target),
    side: lerp(a.side, b.side, t),
    lift: lerp(a.lift, b.lift, t),
  };
}

/** Everything the scene needs, as a pure function of the chapter float. */
export function sceneParams(c: number) {
  return {
    // LiDAR sweep: points below the plane become solid glass
    // past the tallest exploded part once the scan is done, so no stray points
    sweep: c >= 1.75 ? 99 : -0.4 + 3.2 * seg(c, 0.55, 1.75),
    // 0 assembled, 1 fully exploded
    explode: seg(c, 1.75, 2.4) - seg(c, 3.9, 4.55),
    // items glide from clutter to shelf
    sort: seg(c, 4.35, 5.0),
    // lamp is sent to trash
    lampGone: seg(c, 5.7, 5.98),
    // review: item tint switches from provisional to confirmed
    confirm: seg(c, 3.8, 4.3),
  };
}

export type ReviewState = "unknown" | "organize" | "trash";

/** Cards flip unknown -> trash -> organize as the review chapter plays. */
export function reviewState(idx: number, c: number): ReviewState {
  const u = clamp01((c - 3.2) / 0.62);
  const step = Math.floor(clamp01(u - idx * 0.07) * 3.2);
  if (c < 3.2) return "unknown";
  if (c > 3.9) return "organize";
  return (["unknown", "trash", "organize"] as const)[Math.min(2, step)];
}

/** Entry sequence: a slow dolly in on the room while it resolves from points to solid. */
export function entryCamera(c: number) {
  const u = seg(c, 0.3, 1.9);
  const m = (a: V3, b: V3): V3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
  return {
    pos: m([10.5, 6.4, 12.6], [6.6, 3.9, 7.8]),
    target: m([0, 1.2, 0], [0, 0.9, 0]) as V3,
    side: 0,
    lift: 0,
  };
}
