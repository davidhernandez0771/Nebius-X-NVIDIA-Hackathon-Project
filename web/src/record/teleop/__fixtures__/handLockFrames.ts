// Frame sequences for the hand lock (handLock.ts). Test-only.
//
// What MediaPipe hands the Record page at ~30 fps, built from makeHandPose: frame timestamps that
// jitter by a few ms, a little landmark noise on every frame, and the detection array in no fixed
// order (MediaPipe's order is not stable, contracts.ts). Seeded, so every run gets the same frames.
// No real two-hand trace exists yet: before this branch the debug trace kept only the picked hand.

import type { HandFrame, Handedness, TrackedHand } from "../../../hand/contracts";
import { FRAME, VICTORY_FLEX, VICTORY_THUMB, makeHandPose, pinchThumbTip } from "./handPoses";

export const FRAME_MS = 1000 / 30;

/** One hand in one frame: where (image-normalized palm area), which label, how close. */
export interface HandSpec {
  label: Handedness | null;
  center: { x: number; y: number };
  distance?: number; // meters; smaller = closer to the camera, bigger in the image
  pinched?: boolean; // thumb tip on the index tip (the gripper closes)
  victory?: boolean; // the V sign (the reset gesture)
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function trackedHand(spec: HandSpec, noise = 0, rand: () => number = Math.random): TrackedHand {
  const pose = makeHandPose({
    center: spec.center,
    distance: spec.distance ?? 0.5,
    left: spec.label === "Left",
    ...(spec.pinched ? { thumbTip: pinchThumbTip() } : {}),
    ...(spec.victory ? { fingerFlex: VICTORY_FLEX, thumbTip: VICTORY_THUMB } : {}),
  });
  const jitter = () => (rand() - 0.5) * 2 * noise;
  return {
    handedness: spec.label,
    landmarks: pose.landmarks.map((p) => ({ x: p.x + jitter(), y: p.y + jitter(), z: p.z })),
  };
}

/**
 * A sequence of frames: `hands(i)` lists the hands seen in frame i (empty = nobody in view).
 * Timestamps start at t0 and step ~33 ms with +-4 ms jitter; landmarks get +-0.002 noise; the
 * array order is shuffled per frame.
 */
export function recordFrames(n: number, hands: (i: number) => HandSpec[], { seed = 1, t0 = 1000 } = {}): HandFrame[] {
  const rand = rng(seed);
  const frames: HandFrame[] = [];
  for (let i = 0; i < n; i++) {
    const list = hands(i).map((h) => trackedHand(h, 0.002, rand));
    if (rand() < 0.5) list.reverse();
    frames.push({
      timestamp: t0 + i * FRAME_MS + (rand() - 0.5) * 8,
      hands: list,
      frameWidth: FRAME.w,
      frameHeight: FRAME.h,
    });
  }
  return frames;
}

// The two hands of the scenarios. MediaPipe's labels are mirrored on the raw camera frame (live
// test #4), so "Left" is the user's right hand; the fixtures only care that the labels differ.
export const MAIN: HandSpec = { label: "Left", center: { x: 0.35, y: 0.55 } };
export const OTHER: HandSpec = { label: "Right", center: { x: 0.72, y: 0.5 } };

/** Frames 0-14 (~0.5 s): only MAIN, held still, so it locks. Then OTHER enters closer to the camera
 *  (bigger in the image) and stays; MAIN drifts slowly right. */
export const twoHands = recordFrames(60, (i) =>
  i < 15
    ? [MAIN]
    : [{ ...MAIN, center: { x: 0.35 + (i - 15) * 0.003, y: 0.55 } }, { ...OTHER, distance: 0.35 }],
);

/** Both hands in view from the first frame; MAIN still, OTHER still too but appearing 5 frames
 *  later. Then the labels swap for frames 30-33 (MediaPipe's handedness flicker) and the hands
 *  stay where they were. */
export const handSwap = recordFrames(50, (i) => {
  if (i < 5) return [MAIN];
  if (i >= 30 && i < 34) return [{ ...MAIN, label: "Right" }, { ...OTHER, label: "Left" }];
  return [MAIN, OTHER];
});

/** MAIN locks (frames 0-14), then disappears for frames 20-31 (~0.4 s) while OTHER stays in view,
 *  and comes back 0.03 to the right of where it left. */
export const briefLoss = recordFrames(45, (i) => {
  if (i < 15) return [MAIN];
  if (i >= 20 && i < 32) return [OTHER];
  const back = i >= 32 ? { ...MAIN, center: { x: 0.38, y: 0.55 } } : MAIN;
  return [back, OTHER];
});

/** MAIN locks, then disappears for frames 20-59 (~1.3 s, longer than the hold) while OTHER stays;
 *  from frame 60 MAIN is back, still, in a new place far from where it left. */
export const longLoss = recordFrames(90, (i) => {
  if (i < 15) return [MAIN];
  if (i < 20) return [MAIN, OTHER];
  if (i < 60) return [OTHER];
  return [{ ...MAIN, center: { x: 0.45, y: 0.25 } }, OTHER];
});

/** MAIN locks, then on frame 25 alone its landmarks jump 0.3 frame heights up (a MediaPipe glitch);
 *  frame 26 on it is back where it was. */
export const glitchFrame = recordFrames(40, (i) =>
  i === 25 ? [{ ...MAIN, center: { x: 0.35, y: 0.25 } }] : [MAIN],
);
