// The auto-tune (the site build brief): after the intro, measure windows of 120 frames. If two windows
// in a row run slower than 22 ms (median), drop a tier and measure again; below 9 ms on high, go to
// ultra. Then it stops, and the choice is saved (quality.ts saveTier); `?q=` in the URL turns it off.
// Pure: it is fed frame times.
//
// The median, and two windows, because a single hitch (a texture uploading, a shader compiling, the
// garbage collector) must not read as a slow GPU: the mean of a window with one 300 ms frame is over
// 22 ms on any machine. The canvas also starts it only once the models have finished streaming in.
// Only back-to-back frames count: the canvas renders on demand, and a gap isn't a slow frame. On a
// 60 Hz display a frame can't come in under 16.7 ms, so ultra is reached by this only on a faster
// display; the quality chip (or ?q=ultra) sets it by hand.
import type { TierName } from "./quality";

export const TUNE = { frames: 120, slowMs: 22, fastMs: 9, gapMs: 250, slowWindows: 2 } as const;

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface Tuner {
  /** A frame took `ms`. Returns the tier to switch to, or null to stay. */
  sample(ms: number): TierName | null;
  readonly done: boolean;
  readonly tier: TierName;
}

export function createTuner(start: TierName): Tuner {
  let tier = start;
  let done = false;
  let slow = 0;
  let win: number[] = [];
  return {
    get done() {
      return done;
    },
    get tier() {
      return tier;
    },
    sample(ms) {
      if (done || !(ms > 0) || ms > TUNE.gapMs) return null;
      win.push(ms);
      if (win.length < TUNE.frames) return null;
      const med = median(win);
      win = [];
      if (med > TUNE.slowMs && tier !== "low") {
        if (++slow < TUNE.slowWindows) return null;
        slow = 0;
        tier = tier === "ultra" ? "high" : "low";
        return tier;
      }
      slow = 0;
      done = true;
      if (med < TUNE.fastMs && tier === "high") {
        tier = "ultra";
        return tier;
      }
      return null;
    },
  };
}
