// A still hand pinching, as a debug trace (debugTrace.ts TraceFile frames). Test-only.
//
// No live trace of the depth jump was saved, so this models the reported symptom (live test after #10: "every pinch
// makes the arm read the hand as moving back"): the hand stays where it is, the thumb closes on the index tip, and as
// it does the knuckles shift. The index MCP (5) is pulled toward the pinky by KNUCKLE_SHIFT_M and the pinky MCP (17)
// by half that, which narrows the knuckle span |5-17| by ~13%: the pixel palm width reads the hand ~13% farther away.
// The wrist (0) and middle MCP (9) stay put, as the metacarpals are rigid. A little seeded landmark jitter, as
// MediaPipe gives on a still hand. A real trace (TraceFile JSON from the Record page's debug trace) can be fed to the
// same checks instead.

import type { TraceFrame } from "../debugTrace";
import { FRAME, OPEN_THUMB_TIP, canonicalHand, pinchThumbTip, type V3 } from "./handPoses";

export const KNUCKLE_SHIFT_M = 0.006;
export const FRAME_MS = 33;

export interface PinchPlan {
  pinches: number;
  openMs: number; // hand still and open before each pinch (and at the end)
  closeMs: number; // thumb travel, open -> closed (and back)
  holdMs: number; // pinched
  jitter: number; // landmark noise, normalized image units (1 sigma)
  /** Hand center over time, raw image coordinates; default still at the frame center. */
  center?: (t: number) => { x: number; y: number };
  /** Hand distance over time, meters; default 0.5. */
  distance?: (t: number) => number;
}

export const STILL_PINCHES: PinchPlan = { pinches: 4, openMs: 700, closeMs: 150, holdMs: 700, jitter: 0.0008 };

const lerp = (a: V3, b: V3, k: number): V3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

/** 0 open .. 1 pinched at time t, for the plan's repeated open / close / hold / release cycle. */
export function pinchAmount(t: number, p: PinchPlan): number {
  const cycle = p.openMs + 2 * p.closeMs + p.holdMs;
  if (t >= p.pinches * cycle) return 0;
  const c = t % cycle;
  if (c < p.openMs) return 0;
  if (c < p.openMs + p.closeMs) return (c - p.openMs) / p.closeMs;
  if (c < p.openMs + p.closeMs + p.holdMs) return 1;
  return 1 - (c - p.openMs - p.closeMs - p.holdMs) / p.closeMs;
}

export function planMs(p: PinchPlan): number {
  return p.pinches * (p.openMs + 2 * p.closeMs + p.holdMs) + p.openMs;
}

/** A seeded normal(0, 1) stream (mulberry32 + Box-Muller), so the fixture is the same on every run. */
function gauss(seed: number): () => number {
  let s = seed >>> 0;
  const uni = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uni() || 1e-12)) * Math.cos(2 * Math.PI * uni());
}

/** The hand's 21 canonical points at pinch amount k: thumb toward the index tip, knuckles narrowing. */
export function pinchingHand(k: number): V3[] {
  const pts = canonicalHand({ thumbTip: lerp(OPEN_THUMB_TIP, pinchThumbTip(), k) });
  const shift = (i: number, dx: number) => (pts[i] = { ...pts[i], x: pts[i].x + dx * k });
  shift(5, -KNUCKLE_SHIFT_M);
  shift(17, KNUCKLE_SHIFT_M / 2);
  return pts;
}

/** The frames of a still hand pinching, as the Record page's debug trace records them (landmarks and world only). */
export function pinchTraceFrames(p: PinchPlan = STILL_PINCHES, seed = 7): TraceFrame[] {
  const noise = gauss(seed);
  const frames: TraceFrame[] = [];
  for (let t = 0; t <= planMs(p); t += FRAME_MS) {
    const k = pinchAmount(t, p);
    // handPoses.makeHandPose's pinhole projection, applied to the pinching points
    const distance = p.distance?.(t) ?? 0.5;
    const c = p.center?.(t) ?? { x: 0.5, y: 0.5 };
    const world = pinchingHand(k);
    const landmarks = world.map((q) => {
      const zc = distance + q.z;
      return [c.x + (FRAME.focalPx * q.x) / zc / FRAME.w + noise() * p.jitter, c.y + (FRAME.focalPx * q.y) / zc / FRAME.h + noise() * p.jitter, q.z / distance];
    });
    frames.push({
      t,
      frame: [FRAME.w, FRAME.h],
      hands: 1,
      handedness: "Left",
      seen: [],
      lock: null,
      landmarks,
      world: world.map((q) => [q.x, q.y, q.z]),
      pinch: null,
      victory: null,
      reach: { palmWidth: null, size3d: null, stable: null, used: null, reach3d: false },
      clutch: false,
      breakthrough: { count: 0, dir: 1 },
      sent: { tracking_ok: true, wrist_uv: [0, 0], palm_width: 0, pinch_ratio: 0 },
      gripper: 0,
    });
  }
  return frames;
}
