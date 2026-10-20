// Reach (depth) for webcam teleop that a pinch doesn't move (live test after #10: "every pinch makes the arm read
// the hand as moving back").
//
// The old signal was the pixel palm width, the knuckle span |lm5 - lm17|. Pinching curls the index and shifts the
// knuckles toward each other, so the span shrinks and the hand reads farther away. stableSize() measures along the
// metacarpals instead: wrist -> index MCP, wrist -> middle MCP and wrist -> pinky MCP (0-5, 0-9, 0-17), which are
// rigid bones, and takes their median, so one landmark that drifts can't move it. Divided by STABLE_RATIO it is in
// palm-width units, so the depth range, auto-centering and calibration work as before.
//
// DepthAnchor makes depth continuous across every gripper close and open, so whatever a pinch still does to the
// hand's apparent size never moves the arm:
//   - while the thumb is on its way (the pinch gap inside the band between "open" and "closed" for the gripper's
//     state) it holds depth at the median of the last PRE_MS, the level before the pinch started;
//   - when the gripper toggles (or a hold ends without one) it keeps holding for SETTLE_MS, then rescales so the
//     median size over that settle continues from the held level. Only motion after it moves the arm.
// Both levels are medians over a few frames, not single frames: re-anchoring on one noisy frame locks that frame's
// landmark noise in, and over many pinches the depth random-walks (measured: 3 cm over 4 pinches).
// A hold that never ends in a toggle (a relaxed hand with the thumb near the index) lets go after HOLD_MAX_MS, and
// no new hold starts until the gap has left the band.

import type { HandLandmark } from "../../hand/contracts";
import { PINCH_CLOSE_BELOW, PINCH_OPEN_ABOVE } from "./pinch";

/** median(|0-5|, |0-9|, |0-17|) / |5-17| for an open hand facing the camera: the metacarpals over the knuckle span. */
export const STABLE_RATIO = 1.4;
export const HOLD_MAX_MS = 400;
export const PRE_MS = 300; // the level before a pinch: the median size over this long
export const SETTLE_MS = 200; // after a toggle, held this long while the new level is measured

const PAIRS = [
  [0, 5],
  [0, 9],
  [0, 17],
] as const;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The pinch-stable hand size in palm-width units (px / frame width), or null when the hand has no size. */
export function stableSize(lm: readonly HandLandmark[], frameWidth: number, frameHeight: number): number | null {
  const d = PAIRS.map(([a, b]) => Math.hypot((lm[a].x - lm[b].x) * frameWidth, (lm[a].y - lm[b].y) * frameHeight)).sort((a, b) => a - b);
  const size = d[1] / STABLE_RATIO / frameWidth;
  return size > 0 && Number.isFinite(size) ? size : null;
}

type Mode = { kind: "free" } | { kind: "hold"; since: number; value: number } | { kind: "settle"; since: number; value: number; sizes: number[] };

export class DepthAnchor {
  private scale = 1;
  private gripper: 0 | 1 | null = null;
  private mode: Mode = { kind: "free" };
  private recent: { t: number; out: number }[] = []; // given out while free, the last PRE_MS
  private armed = true; // a hold may start (false after one timed out, until the gap leaves the band)

  /**
   * t: the frame's time, ms. size: this frame's reach signal (null: no hand). gap: the pinch gap (pinch.ts), null when
   * there is no new evidence (no hand, a held frame, the spacebar). gripper: the gripper state sent with this frame.
   * Returns the size to use for depth.
   */
  update(t: number, size: number | null, gap: number | null, gripper: 0 | 1): number | null {
    const toggled = this.gripper !== null && gripper !== this.gripper;
    this.gripper = gripper;
    if (size === null || !(size > 0)) return null;
    const inBand = gap !== null && (gripper === 0 ? gap < PINCH_OPEN_ABOVE : gap > PINCH_CLOSE_BELOW);
    const m = this.mode;

    if (toggled) {
      const value = m.kind === "free" ? this.level(size) : m.value;
      this.mode = { kind: "settle", since: t, value, sizes: [size] };
      this.armed = !inBand;
      return value;
    }
    if (m.kind === "settle") {
      m.sizes.push(size);
      if (t - m.since < SETTLE_MS) return m.value;
      this.scale = m.value / median(m.sizes);
      this.free();
      return this.out(t, size);
    }
    if (m.kind === "hold") {
      const expired = t - m.since > HOLD_MAX_MS;
      if (inBand && !expired) return m.value;
      if (inBand) this.armed = false;
      this.mode = { kind: "settle", since: t, value: m.value, sizes: [size] };
      return m.value;
    }
    if (!inBand) this.armed = true;
    else if (this.armed && this.recent.length) {
      const value = this.level(size);
      this.mode = { kind: "hold", since: t, value };
      return value;
    }
    return this.out(t, size);
  }

  /** The level to hold: the median given out over the last PRE_MS (this frame's size alone if there is none). */
  private level(size: number): number {
    return this.recent.length ? median(this.recent.map((r) => r.out)) : size * this.scale;
  }

  private free() {
    this.mode = { kind: "free" };
    this.recent = [];
  }

  private out(t: number, size: number): number {
    const out = size * this.scale;
    this.recent.push({ t, out });
    while (this.recent.length && t - this.recent[0].t > PRE_MS) this.recent.shift();
    return out;
  }
}
