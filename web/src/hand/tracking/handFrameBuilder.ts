// Pure landmarks/handedness -> TrackedHand[] conversion (Agent 1).
//
// Isolated from the MediaPipe SDK's classes (HandLandmarker, HandLandmarkerResult)
// so it's unit-testable without a real camera or model. Structural typing lets
// it accept MediaPipe's actual NormalizedLandmark[][]/Category[][] result
// fields directly, or plain test fixtures shaped the same way.

import type { HandLandmark, Handedness, TrackedHand } from "../contracts";

interface RawLandmark {
  x: number;
  y: number;
  z: number;
}

interface RawHandednessCategory {
  categoryName: string;
}

function toHandedness(category: RawHandednessCategory | undefined): Handedness | null {
  const name = category?.categoryName;
  return name === "Left" || name === "Right" ? name : null;
}

/**
 * Converts MediaPipe's per-hand landmark/handedness result arrays into the
 * contract's `TrackedHand[]`. Array order is passed through UNCHANGED --
 * per contracts.ts, detection order is not stable identity (`handedness`
 * is), and sorting or reordering here would misleadingly imply otherwise.
 *
 * `handednessPerHand[i][0]` is hand `i`'s top-ranked handedness
 * classification -- MediaPipe returns one Category per hand in practice,
 * but the API allows more; only the top one is used, matching the rest of
 * this pipeline. A missing or unrecognized category yields `null`
 * (low-confidence classification), which GestureProcessor is documented to
 * exclude from primary/secondary role assignment.
 */
export function buildTrackedHands(
  landmarksPerHand: RawLandmark[][],
  handednessPerHand: RawHandednessCategory[][],
): TrackedHand[] {
  return landmarksPerHand.map((landmarks, i) => ({
    landmarks: landmarks.map((l): HandLandmark => ({ x: l.x, y: l.y, z: l.z })),
    handedness: toHandedness(handednessPerHand[i]?.[0]),
  }));
}
