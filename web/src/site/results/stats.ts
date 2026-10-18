// The Results page's statistics: the Wilson 95% CI (the same interval T1's
// src/demo_pipeline/stats.py prints in the notes) and the running tally used to
// replay an eval scene by scene. Pure, so the page never computes a number the
// tests haven't checked.

const Z95 = 1.959963984540054;

/** Wilson score interval for k successes in n trials, as fractions 0..1. With n = 0 nothing is known: [0, 1]. */
export function wilson(k: number, n: number, z = Z95): [number, number] {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || n < 0 || k > n) throw new Error(`no Wilson CI for ${k}/${n}`);
  if (n === 0) return [0, 1];
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export type Frame = { n: number; k: number; rate: number | null; lo: number; hi: number };

/** One frame per scene, from the empty start (n = 0) to the last; `outcomes` is "1" for a success, "0" for a failure. */
export function replay(outcomes: string): Frame[] {
  if (!/^[01]*$/.test(outcomes)) throw new Error(`outcomes must be 0s and 1s, got ${outcomes}`);
  const frames: Frame[] = [{ n: 0, k: 0, rate: null, lo: 0, hi: 1 }];
  let k = 0;
  [...outcomes].forEach((c, i) => {
    if (c === "1") k++;
    const n = i + 1;
    const [lo, hi] = wilson(k, n);
    frames.push({ n, k, rate: k / n, lo, hi });
  });
  return frames;
}
