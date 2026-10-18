// The hand skeleton as shader uniforms: joints and bones in the overlay's own
// space (x stretched by the canvas aspect so circles stay round, y up like GL uv).

import type { HandLandmark } from "../../hand/contracts";

export const JOINT_COUNT = 21;

// MediaPipe hand skeleton: landmark index pairs (the same set RecordPage draws).
export const HAND_BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const TIPS = new Set([4, 8, 12, 16, 20]);
const PALM = [0, 5, 9, 13, 17];

// Sizes as fractions of the hand scale (wrist to middle knuckle).
const BONE_RADIUS = 0.05;
const JOINT_RADIUS = 0.065;
const TIP_RADIUS = 0.09;
const WRIST_RADIUS = 0.085;

export interface PackOptions {
  /** Canvas width / height. */
  aspect: number;
  /** Flip x like a mirror (u -> 1-u), to match a mirrored webcam view. */
  mirrored: boolean;
}

export interface PackedSkeleton {
  /** 21 x (x, y, radius, z). */
  joints: Float32Array;
  /** 21 x (ax, ay, bx, by). */
  bones: Float32Array;
  boneRadius: number;
  scale: number;
  /** Palm center: the mean of the wrist and the four knuckles. */
  palm: [number, number];
  /** 5 x (x, y, dx, dy): each fingertip and its unit direction out of the finger (DIP to tip). */
  tips: Float32Array;
}

/** Wrist to middle knuckle, in aspect-corrected units (the overlay's unit of hand size). */
export function handScale(lm: readonly HandLandmark[], aspect: number): number {
  return Math.hypot((lm[0].x - lm[9].x) * aspect, lm[0].y - lm[9].y);
}

/** Null for no hand, or one that is not 21 finite landmarks. */
export function packSkeleton(lm: readonly HandLandmark[] | null | undefined, opts: PackOptions): PackedSkeleton | null {
  if (!lm || lm.length !== JOINT_COUNT) return null;
  if (!lm.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))) return null;

  const scale = handScale(lm, opts.aspect);
  const px = (p: HandLandmark) => (opts.mirrored ? 1 - p.x : p.x) * opts.aspect;
  const py = (p: HandLandmark) => 1 - p.y;

  const joints = new Float32Array(JOINT_COUNT * 4);
  lm.forEach((p, i) => {
    const r = i === 0 ? WRIST_RADIUS : TIPS.has(i) ? TIP_RADIUS : JOINT_RADIUS;
    joints.set([px(p), py(p), r * scale, p.z], i * 4);
  });

  const bones = new Float32Array(HAND_BONES.length * 4);
  HAND_BONES.forEach(([a, b], i) => bones.set([px(lm[a]), py(lm[a]), px(lm[b]), py(lm[b])], i * 4));

  const palm: [number, number] = [
    PALM.reduce((s, i) => s + px(lm[i]), 0) / PALM.length,
    PALM.reduce((s, i) => s + py(lm[i]), 0) / PALM.length,
  ];

  const tips = new Float32Array(20);
  [4, 8, 12, 16, 20].forEach((t, f) => {
    const dx = px(lm[t]) - px(lm[t - 1]);
    const dy = py(lm[t]) - py(lm[t - 1]);
    const len = Math.hypot(dx, dy);
    tips.set(len > 1e-6 ? [px(lm[t]), py(lm[t]), dx / len, dy / len] : [px(lm[t]), py(lm[t]), 0, 1], f * 4);
  });

  return { joints, bones, boneRadius: BONE_RADIUS * scale, scale, palm, tips };
}
