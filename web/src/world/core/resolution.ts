// How many pixels the canvas renders. Two limits on top of the tier's pixel-ratio cap:
// - a pixel budget per tier, so a 1600p or 4K laptop panel doesn't render 4+ megapixels through the
//   post and its MSAA target (Active Theory renders at a fixed 1.5x for the same reason);
// - a live scale (createScaler): when frames run slow it renders fewer pixels, a step at a time,
//   before the auto-tune has to drop a whole tier, and gives them back when there is headroom.
// Pure, so both are tested.
import { median } from "./autotune";
import type { QualityTier, TierName } from "./quality";

/** Physical pixels the canvas may render, per tier. */
export const PIXEL_BUDGET: Record<TierName, number> = { low: 1.3e6, high: 2.6e6, ultra: 3.7e6 };

/** The canvas pixel ratio for a tier, a CSS size, the device's ratio and the live scale. */
export function targetDpr(tier: QualityTier, cssW: number, cssH: number, deviceDpr: number, scale = 1): number {
  const area = Math.max(1, cssW * cssH);
  const cap = Math.min(tier.dpr[1], deviceDpr || 1, Math.sqrt(PIXEL_BUDGET[tier.name] / area));
  const dpr = Math.max(0.5, Math.max(tier.dpr[0] * 0.75, cap) * scale);
  return Math.round(dpr * 100) / 100;
}

/**
 * Windows of 60 frames, judged by the median. Down a step after 2 slow windows in a row, up a step
 * after 3 fast ones, and the window after any change is skipped: every change reallocates the
 * canvas and the post targets (a hitch of its own), so it must never flip back and forth.
 */
export const SCALE = { frames: 60, slowMs: 19, fastMs: 12.5, min: 0.6, down: 0.15, up: 0.1, gapMs: 250, slowWindows: 2, fastWindows: 3 } as const;

export interface Scaler {
  /** A frame took `ms`. Returns the new scale when it changes, else null. */
  sample(ms: number): number | null;
  readonly scale: number;
}

export function createScaler(start = 1): Scaler {
  let scale = start;
  let win: number[] = [];
  let slow = 0;
  let fast = 0;
  let skip = false;
  return {
    get scale() {
      return scale;
    },
    sample(ms) {
      if (!(ms > 0) || ms > SCALE.gapMs) return null;
      win.push(ms);
      if (win.length < SCALE.frames) return null;
      const med = median(win);
      win = [];
      // The window right after a change measures the change's own reallocation: skip it.
      if (skip) {
        skip = false;
        return null;
      }
      slow = med > SCALE.slowMs ? slow + 1 : 0;
      fast = med < SCALE.fastMs ? fast + 1 : 0;
      const prev = scale;
      if (slow >= SCALE.slowWindows) scale = Math.max(SCALE.min, scale - SCALE.down);
      else if (fast >= SCALE.fastWindows) scale = Math.min(1, scale + SCALE.up);
      scale = Math.round(scale * 100) / 100;
      if (scale === prev) return null;
      slow = 0;
      fast = 0;
      skip = true;
      return scale;
    },
  };
}
