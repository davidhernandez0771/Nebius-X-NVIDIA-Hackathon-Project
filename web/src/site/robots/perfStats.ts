// Frame-time statistics for the ?perf overlay: a ring of the last `cap` frame intervals (ms).

/** Nearest-rank percentile (p in 0..100) of xs, without reordering xs. */
export function percentile(xs: ArrayLike<number>, p: number): number {
  if (!xs.length) return 0;
  const s = Array.from(xs).sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export class FrameStats {
  private buf: Float64Array;
  private n = 0;
  private head = 0;

  constructor(private cap = 600) {
    this.buf = new Float64Array(cap);
  }

  push(dtMs: number) {
    this.buf[this.head] = dtMs;
    this.head = (this.head + 1) % this.cap;
    this.n = Math.min(this.cap, this.n + 1);
  }

  private values(): Float64Array {
    return this.n < this.cap ? this.buf.subarray(0, this.n) : this.buf;
  }

  count() {
    return this.n;
  }

  fps() {
    if (!this.n) return 0;
    let sum = 0;
    for (const v of this.values()) sum += v;
    return 1000 / (sum / this.n);
  }

  p95() {
    return percentile(this.values(), 95);
  }

  max() {
    let m = 0;
    for (const v of this.values()) m = Math.max(m, v);
    return m;
  }

  /** Frames slower than budgetMs. */
  over(budgetMs: number) {
    let c = 0;
    for (const v of this.values()) if (v > budgetMs) c++;
    return c;
  }

  reset() {
    this.n = 0;
    this.head = 0;
  }
}
