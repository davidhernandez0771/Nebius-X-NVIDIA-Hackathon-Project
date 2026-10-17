// What the Dataset page can say from GET /demos alone. True multiplication
// yield needs failed attempts too, which the store doesn't keep; the page
// says so instead of guessing.

import type { Demo, DemoSource } from "../types";

export interface DemoSummary {
  total: number;
  counts: Record<DemoSource, number>;
  humanMinutes: number;
  perfectedPerHuman: number | null;
  variantsPerPerfected: number | null;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function summarizeDemos(demos: Demo[]): DemoSummary {
  const counts: Record<DemoSource, number> = { human: 0, repaired: 0, variant: 0 };
  let humanSeconds = 0;
  for (const d of demos) {
    counts[d.source] += 1;
    if (d.source === "human") humanSeconds += d.human_seconds;
  }
  return {
    total: demos.length,
    counts,
    humanMinutes: humanSeconds / 60,
    perfectedPerHuman: ratio(counts.repaired, counts.human),
    variantsPerPerfected: ratio(counts.variant, counts.repaired),
  };
}
