// The auto-tune (the site build brief): after the intro, average 120 frames. Above 22 ms a frame,
// drop a tier and measure again; below 9 ms on high, go to ultra. Then it stops, and the choice is
// saved (quality.ts saveTier); `?q=` in the URL turns it off. Pure: it is fed frame times.
//
// Only back-to-back frames count: the canvas renders on demand, and a gap (an idle page, a hidden tab)
// isn't a slow frame. On a 60 Hz display a frame can't come in under 16.7 ms, so ultra is reached by
// this only on a faster display; the quality chip (or ?q=ultra) sets it by hand.
import type { TierName } from "./quality";

export const TUNE = { frames: 120, slowMs: 22, fastMs: 9, gapMs: 250 } as const;

export interface Tuner {
  /** A frame took `ms`. Returns the tier to switch to, or null to stay. */
  sample(ms: number): TierName | null;
  readonly done: boolean;
  readonly tier: TierName;
}

export function createTuner(start: TierName): Tuner {
  let tier = start;
  let done = false;
  let n = 0;
  let sum = 0;
  return {
    get done() {
      return done;
    },
    get tier() {
      return tier;
    },
    sample(ms) {
      if (done || !(ms > 0) || ms > TUNE.gapMs) return null;
      sum += ms;
      if (++n < TUNE.frames) return null;
      const avg = sum / n;
      n = 0;
      sum = 0;
      if (avg > TUNE.slowMs && tier !== "low") {
        tier = tier === "ultra" ? "high" : "low";
        return tier;
      }
      done = true;
      if (avg < TUNE.fastMs && tier === "high") {
        tier = "ultra";
        return tier;
      }
      return null;
    },
  };
}
