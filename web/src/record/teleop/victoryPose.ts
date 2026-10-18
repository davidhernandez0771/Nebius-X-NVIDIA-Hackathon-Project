// The V sign (Victory) from HandLandmarker landmarks, for the reset gesture (resetGesture.ts).
// We keep HandLandmarker instead of switching to GestureRecognizer, so the gesture is classified
// here: index and middle extended, ring and pinky curled; the thumb is ignored.
//
// Per finger, the bend is the sum of its three joint angles (wrist->MCP->PIP, MCP->PIP->DIP,
// PIP->DIP->TIP): about 0 straight, 3-4 rad curled into the palm. From world landmarks (meters)
// the angles don't depend on how the hand is turned; without them, the same angles on the image
// (px, aspect-correct) are a fallback that works with the palm toward the camera.

import type { HandLandmark, TrackedHand } from "../../hand/contracts";

export interface VictoryScore {
  score: number; // 0..1; the reset gesture counts >= 0.85
  source: "3d" | "2d";
}

const FINGERS = [
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
] as const;

// Bend (rad) for "extended" (1 at or below STRAIGHT_FULL, 0 at STRAIGHT_NONE and above) and for
// "curled" (0 at CURL_NONE and below, 1 at CURL_FULL and above). Starting points; a real V sign
// keeps its ring and pinky well curled.
const STRAIGHT_FULL = 0.8;
const STRAIGHT_NONE = 1.6;
const CURL_NONE = 1.2;
const CURL_FULL = 2.2;

type P = { x: number; y: number; z: number };

function angle(a: P, b: P, c: P): number {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const n = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z);
  if (!(n > 0)) return 0;
  return Math.acos(Math.min(1, Math.max(-1, (u.x * v.x + u.y * v.y + u.z * v.z) / n)));
}

function bends(pts: readonly P[]): number[] {
  return FINGERS.map(([mcp, pip, dip, tip]) => angle(pts[0], pts[mcp], pts[pip]) + angle(pts[mcp], pts[pip], pts[dip]) + angle(pts[pip], pts[dip], pts[tip]));
}

const ramp = (v: number, lo: number, hi: number) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

export function victoryScore(hand: TrackedHand, frameWidth: number, frameHeight: number): VictoryScore {
  const world = hand.worldLandmarks && hand.worldLandmarks.length >= 21 ? hand.worldLandmarks : null;
  const pts: readonly P[] = world ?? hand.landmarks.map((p: HandLandmark) => ({ x: p.x * frameWidth, y: p.y * frameHeight, z: 0 }));
  const [index, middle, ring, pinky] = bends(pts);
  const extended = (b: number) => 1 - ramp(b, STRAIGHT_FULL, STRAIGHT_NONE);
  const curled = (b: number) => ramp(b, CURL_NONE, CURL_FULL);
  const score = Math.min(extended(index), extended(middle), curled(ring), curled(pinky));
  return { score, source: world ? "3d" : "2d" };
}
