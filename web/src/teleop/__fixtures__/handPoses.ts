// Synthetic hands for the 3D pinch (pinch.ts). Test-only.
//
// World landmarks follow MediaPipe's worldLandmarks axes as documented: meters, x to the right
// of the RAW image, y down, z away from the camera, origin near the hand's center. The canonical
// hand is an anatomical RIGHT hand, fingers up, palm facing the camera: on the raw (unmirrored)
// image its index side (landmark 5) is on the right (+x), the pinky (17) on the left.
// Image landmarks come from a pinhole projection of the same points.

import type { HandLandmark } from "../../hand/contracts";

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface HandPoseOptions {
  /** Flexion per joint (MCP, PIP, DIP) in radians, toward the palm side; 0 = straight. */
  flex?: [number, number, number];
  /** Thumb tip, canonical coordinates; default: thumb out to the side, open. */
  thumbTip?: V3;
  /** Rotation: about x (pitch), then y (turn), then z (roll in the image plane), radians. */
  rot?: { x?: number; y?: number; z?: number };
  /** Mirror x: an anatomical LEFT hand. */
  left?: boolean;
  /** Hand center distance from the camera, meters. */
  distance?: number;
  /** Image position of the hand center, normalized. */
  center?: { x: number; y: number };
}

export const FRAME = { w: 640, h: 480, focalPx: 600 };

const OPEN_FLEX: [number, number, number] = [0.08, 0.08, 0.05];
export const FIST_FLEX: [number, number, number] = [1.45, 1.65, 1.1];

// Finger MCP bases (canonical) and segment lengths (proximal, middle, distal), meters.
const FINGERS: { mcp: V3; len: [number, number, number]; splay: number }[] = [
  { mcp: { x: 0.025, y: -0.035, z: 0 }, len: [0.04, 0.024, 0.02], splay: 0.08 }, // index 5-8
  { mcp: { x: 0.004, y: -0.042, z: 0 }, len: [0.044, 0.028, 0.021], splay: 0 }, // middle 9-12
  { mcp: { x: -0.016, y: -0.038, z: 0 }, len: [0.041, 0.026, 0.02], splay: -0.06 }, // ring 13-16
  { mcp: { x: -0.033, y: -0.03, z: 0 }, len: [0.032, 0.019, 0.018], splay: -0.14 }, // pinky 17-20
];

export const OPEN_THUMB_TIP: V3 = { x: 0.075, y: -0.02, z: -0.02 };

function fingerChain(mcp: V3, len: [number, number, number], splay: number, flex: [number, number, number]): V3[] {
  const pts: V3[] = [mcp];
  let angle = 0;
  let p = mcp;
  for (let i = 0; i < 3; i++) {
    angle += flex[i];
    // Straight up (-y), tilted sideways by splay, flexed toward the palm side (-z, the camera).
    const d = { x: Math.sin(splay) * Math.cos(angle), y: -Math.cos(splay) * Math.cos(angle), z: -Math.sin(angle) };
    p = { x: p.x + d.x * len[i], y: p.y + d.y * len[i], z: p.z + d.z * len[i] };
    pts.push(p);
  }
  return pts;
}

function rotate(p: V3, r: { x?: number; y?: number; z?: number }): V3 {
  let { x, y, z } = p;
  const [cx, sx] = [Math.cos(r.x ?? 0), Math.sin(r.x ?? 0)];
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const [cy, sy] = [Math.cos(r.y ?? 0), Math.sin(r.y ?? 0)];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const [cz, sz] = [Math.cos(r.z ?? 0), Math.sin(r.z ?? 0)];
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return { x, y, z };
}

/** Canonical 21 points (anatomical right, palm to camera), before rotation. */
export function canonicalHand(opts: Pick<HandPoseOptions, "flex" | "thumbTip"> = {}): V3[] {
  const flex = opts.flex ?? OPEN_FLEX;
  const tip = opts.thumbTip ?? OPEN_THUMB_TIP;
  const wrist = { x: 0, y: 0.045, z: 0 };
  const cmc = { x: 0.024, y: 0.033, z: -0.006 };
  const lerp = (a: V3, b: V3, k: number): V3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
  const pts: V3[] = [wrist, cmc, lerp(cmc, tip, 0.4), lerp(cmc, tip, 0.72), tip];
  for (const f of FINGERS) pts.push(...fingerChain(f.mcp, f.len, f.splay, flex));
  return pts;
}

export interface SyntheticHand {
  world: V3[];
  landmarks: HandLandmark[];
}

export function makeHandPose(opts: HandPoseOptions = {}): SyntheticHand {
  const distance = opts.distance ?? 0.5;
  const center = opts.center ?? { x: 0.5, y: 0.5 };
  const world = canonicalHand(opts).map((p) => rotate(opts.left ? { ...p, x: -p.x } : p, opts.rot ?? {}));
  const landmarks = world.map((p) => {
    const zc = distance + p.z;
    return {
      x: center.x + (FRAME.focalPx * p.x) / zc / FRAME.w,
      y: center.y + (FRAME.focalPx * p.y) / zc / FRAME.h,
      z: p.z / distance,
    };
  });
  return { world, landmarks };
}

/** Hand pointing down, palm toward the table (edge-on to the camera),
 *  with the hidden thumb "seen" right next to the index tip, so a 2D or 3D pinch reads closed. */
export function hallucinatedThumbPose(): SyntheticHand {
  const indexTip = canonicalHand()[8];
  return makeHandPose({ rot: { x: Math.PI / 2 }, thumbTip: { ...indexTip, x: indexTip.x - 0.008 } });
}

/** Thumb tip touching the index tip (a real pinch), canonical frame. */
export function pinchThumbTip(flex: [number, number, number] = OPEN_FLEX): V3 {
  const idx = canonicalHand({ flex })[8];
  return { x: idx.x - 0.006, y: idx.y, z: idx.z - 0.004 };
}
