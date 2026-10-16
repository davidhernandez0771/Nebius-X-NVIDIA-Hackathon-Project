// The Results page's data file and chart geometry. Until the experiments run,
// the only file is ../mocks/results.sample.json. A file counts as real only
// if it says "sample": false; anything else is shown as sample data.

export interface Series {
  key: string;
  label: string;
  success: number[]; // policy success rate per demo count, 0..1
}

export interface Results {
  sample: boolean;
  demos: number[]; // human demo counts on the x axis
  series: Series[];
  ablation: { demos: number; bars: { key: string; label: string; success: number }[] };
  multiply_yield: { ours: number; mimicgen: [number, number] };
}

function rate(v: unknown, what: string): number {
  if (typeof v !== "number" || !(v >= 0 && v <= 1)) throw new Error(`${what} must be a rate between 0 and 1, got ${v}`);
  return v;
}

export function parseResults(input: unknown): Results {
  const raw = input as Partial<Results> & Record<string, unknown>;
  if (!Array.isArray(raw.demos) || !Array.isArray(raw.series)) throw new Error("results need demos and series");
  const series = raw.series.map((s) => {
    if (!Array.isArray(s.success) || s.success.length !== raw.demos!.length)
      throw new Error(`series ${s.key} needs one success rate per demo count`);
    return { key: s.key, label: s.label, success: s.success.map((v, i) => rate(v, `${s.key}[${i}]`)) };
  });
  const ablation = raw.ablation!;
  const y = raw.multiply_yield!;
  return {
    sample: raw.sample !== false,
    demos: raw.demos,
    series,
    ablation: { demos: ablation.demos, bars: ablation.bars.map((b) => ({ ...b, success: rate(b.success, b.key) })) },
    multiply_yield: { ours: rate(y.ours, "multiply_yield.ours"), mimicgen: [rate(y.mimicgen[0], "mimicgen"), rate(y.mimicgen[1], "mimicgen")] },
  };
}

export interface Box {
  width: number;
  height: number;
  pad: number;
}

/** Evenly spaced x (demo counts are categories), success 0 at the bottom and 1 at the top. */
export function chartPoints(values: number[], box: Box): { x: number; y: number }[] {
  const w = box.width - 2 * box.pad;
  const h = box.height - 2 * box.pad;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => ({ x: box.pad + i * step, y: box.pad + (1 - v) * h }));
}
