// Optional "3D reach" (hand v3): reach from the image-vs-world scale fit instead of the pixel
// palm width, which shrinks whenever the hand turns.
//
// s = sum(x_img . X_w) / sum |X_w|^2 over the centered landmarks: x_img in px, X_w the world
// landmarks' x and y in meters (MediaPipe's axes match the image's: x right, y down). Under weak
// perspective s = f / Z, px per meter at the hand, whatever its rotation, so 1 / s goes with the
// distance. To reuse the palm-width reach as it is (depth range, auto-centering, smoothing), the
// signal is s * |wl5 - wl17| / frame width: the palm width the hand would show facing the camera.

import type { HandLandmark, TrackedHand } from "../../hand/contracts";

type P = { x: number; y: number; z: number };

/** The weak-perspective scale in px per meter, or null when it can't be fitted. */
export function scaleFit(landmarks: readonly HandLandmark[], world: readonly P[], frameWidth: number, frameHeight: number): number | null {
  const n = Math.min(landmarks.length, world.length);
  if (n < 4) return null;
  let ix = 0;
  let iy = 0;
  let wx = 0;
  let wy = 0;
  for (let i = 0; i < n; i++) {
    ix += landmarks[i].x * frameWidth;
    iy += landmarks[i].y * frameHeight;
    wx += world[i].x;
    wy += world[i].y;
  }
  ix /= n;
  iy /= n;
  wx /= n;
  wy /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const X = world[i].x - wx;
    const Y = world[i].y - wy;
    num += (landmarks[i].x * frameWidth - ix) * X + (landmarks[i].y * frameHeight - iy) * Y;
    den += X * X + Y * Y;
  }
  if (!(den > 0)) return null;
  const s = num / den;
  return Number.isFinite(s) && s > 0 ? s : null;
}

/** The 3D reach signal in palm-width units (frame widths), or null without usable world landmarks. */
export function reachSize3d(hand: TrackedHand, frameWidth: number, frameHeight: number): number | null {
  const world = hand.worldLandmarks;
  if (!world || world.length < 21) return null;
  const s = scaleFit(hand.landmarks, world, frameWidth, frameHeight);
  if (s === null) return null;
  const palm = Math.hypot(world[5].x - world[17].x, world[5].y - world[17].y, world[5].z - world[17].z);
  const size = (s * palm) / frameWidth;
  return size > 0 && Number.isFinite(size) ? size : null;
}

/** What reach is computed from: the pixel palm width, or with 3D reach on the 3D size when there is one. */
export function depthSize(hand: TrackedHand, palmWidth: number, frameWidth: number, frameHeight: number, reach3d: boolean): number {
  return (reach3d && reachSize3d(hand, frameWidth, frameHeight)) || palmWidth;
}
