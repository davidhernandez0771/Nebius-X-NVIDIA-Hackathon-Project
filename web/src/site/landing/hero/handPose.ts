// The hero's heavy hand, as the 21 hand-tracking landmarks (MediaPipe's order: 0 wrist, 1–4 thumb,
// 5–8 index, 9–12 middle, 13–16 ring, 17–20 pinky). It is seen from the thumb side, fingers along +x,
// palm toward +y: the index on top, the thumb below it, the other three fingers relaxed behind them.
// The thumb–index pinch closes as `pinch` goes 0 → 1. Pure, so the tests need no canvas;
// HeroCanvas.tsx draws it.

export type Pt = { x: number; y: number };

/** Thumb tip to index tip at a full pinch, in palm lengths: the two pads touch, they don't overlap. */
export const PINCH_TIP_GAP = 0.04;

/**
 * Bones as landmark pairs, with a width in palm lengths, and whether the bone is in front (the thumb
 * and index, which make the pinch) or behind (the other three fingers, drawn lighter for depth).
 */
export const HAND_BONES: ReadonlyArray<readonly [number, number, number, "front" | "back"]> = [
  [9, 10, 0.15, "back"],
  [10, 11, 0.13, "back"],
  [11, 12, 0.11, "back"],
  [13, 14, 0.14, "back"],
  [14, 15, 0.12, "back"],
  [15, 16, 0.1, "back"],
  [17, 18, 0.12, "back"],
  [18, 19, 0.1, "back"],
  [19, 20, 0.09, "back"],
  [2, 3, 0.19, "front"],
  [3, 4, 0.16, "front"],
  [5, 6, 0.16, "front"],
  [6, 7, 0.14, "front"],
  [7, 8, 0.12, "front"],
];

const dir = (a: number): Pt => ({ x: Math.cos(a), y: Math.sin(a) });
const add = (p: Pt, v: Pt, k = 1): Pt => ({ x: p.x + v.x * k, y: p.y + v.y * k });
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Two bones from `base` toward `target`; `bend` picks which side the middle joint bulges to. */
export function solveTwoLink(base: Pt, target: Pt, l1: number, l2: number, bend: 1 | -1): { mid: Pt; end: Pt } {
  const dx = target.x - base.x;
  const dy = target.y - base.y;
  const theta = Math.atan2(dy, dx);
  const d = Math.min(l1 + l2, Math.max(Math.abs(l1 - l2) + 1e-9, Math.hypot(dx, dy)));
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const mid = add(base, dir(theta + bend * Math.acos(cosA)), l1);
  const reach = add(base, dir(theta), d);
  const v = { x: reach.x - mid.x, y: reach.y - mid.y };
  const len = Math.hypot(v.x, v.y) || 1;
  return { mid, end: add(mid, v, l2 / len) };
}

/** A finger from its knuckle: each joint adds its bend to the direction so far. */
function chain(mcp: Pt, base: number, lengths: readonly number[], bends: readonly number[]): Pt[] {
  const pts = [mcp];
  let a = base;
  let p = mcp;
  lengths.forEach((l, i) => {
    a += bends[i];
    p = add(p, dir(a), l);
    pts.push(p);
  });
  return pts;
}

type Finger = { mcp: Pt; base: number; lengths: readonly [number, number, number]; open: readonly [number, number, number]; shut: readonly [number, number, number] };

// Hand-tuned proportions, in palm lengths (wrist to index knuckle ≈ 1). From the thumb side the
// knuckles stack almost on top of each other; the back fingers sit a little lower and fan down.
const INDEX: Finger = { mcp: { x: 0.95, y: -0.1 }, base: -0.1, lengths: [0.42, 0.25, 0.2], open: [0.12, 0.16, 0.1], shut: [0.75, 0.95, 0.6] };
const OTHERS: Finger[] = [
  { mcp: { x: 0.96, y: -0.05 }, base: 0.12, lengths: [0.44, 0.27, 0.19], open: [0.35, 0.45, 0.3], shut: [0.55, 0.65, 0.4] },
  { mcp: { x: 0.91, y: -0.01 }, base: 0.24, lengths: [0.4, 0.25, 0.18], open: [0.45, 0.5, 0.3], shut: [0.62, 0.7, 0.42] },
  { mcp: { x: 0.84, y: 0.03 }, base: 0.36, lengths: [0.32, 0.2, 0.16], open: [0.5, 0.55, 0.35], shut: [0.7, 0.75, 0.45] },
];
const THUMB_CMC: Pt = { x: 0.3, y: 0.26 };
const THUMB_MCP: Pt = { x: 0.62, y: 0.32 };
const THUMB = [0.38, 0.32] as const;
const THUMB_OPEN_TIP = add(THUMB_MCP, dir(0.5), 0.69);

/** The palm and the back of the hand as one outline: wrist top, along the back to the index knuckle, round the thumb's heel, back to the wrist. */
const PALM_OUTLINE: Pt[] = [
  { x: 0, y: -0.2 },
  { x: 0.5, y: -0.21 },
  { x: 0.88, y: -0.18 },
  { x: 1.02, y: -0.08 },
  { x: 0.98, y: 0.06 },
  { x: 0.72, y: 0.28 },
  THUMB_MCP,
  { x: 0.48, y: 0.4 },
  THUMB_CMC,
  { x: 0, y: 0.2 },
];

type Place = { x: number; y: number; scale: number; angle: number; mirror?: boolean };

function placer({ x, y, scale, angle, mirror = false }: Place) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = mirror ? -1 : 1;
  return (q: Pt): Pt => ({ x: x + scale * (q.x * c - m * q.y * s), y: y + scale * (q.x * s + m * q.y * c) });
}

function bendsAt(f: Finger, p: number) {
  return f.open.map((o, i) => o + (f.shut[i] - o) * p);
}

/** `mirror` flips the hand across its own axis (a left hand, or the thumb on the other side). */
export function handPose(place: Place & { pinch: number }): Pt[] {
  const p = Math.min(1, Math.max(0, place.pinch));
  const index = chain(INDEX.mcp, INDEX.base, INDEX.lengths, bendsAt(INDEX, p));
  const others = OTHERS.map((f) => chain(f.mcp, f.base, f.lengths, bendsAt(f, p)));
  // The thumb tip travels from its open rest to just under the index pad.
  const pad = add(index[3], { x: 0, y: PINCH_TIP_GAP });
  const { mid, end } = solveTwoLink(THUMB_MCP, lerp(THUMB_OPEN_TIP, pad, p), THUMB[0], THUMB[1], 1);
  const local: Pt[] = [{ x: 0, y: 0 }, THUMB_CMC, THUMB_MCP, mid, end, ...index, ...others.flat()];
  return local.map(placer(place));
}

/** The palm outline, placed like handPose. */
export function palmOutline(place: Place): Pt[] {
  return PALM_OUTLINE.map(placer(place));
}
