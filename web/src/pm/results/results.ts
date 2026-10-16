// The Results page's data file and chart geometry.
//
// Real results come from GET /results (DATA_DIR/results/results.json, written by T1's
// scripts/build_results_json.py); until there are any, the page uses
// ../mocks/results.sample.json. A file counts as real only if it says "sample": false.
// Anything not measured yet is null and the page shows it as pending, never as 0.
// Fields this page doesn't use (such as provenance) are ignored.

export type Rate = number | null; // 0..1, or null while pending

export interface Series {
  key: string;
  label: string;
  success: Rate[]; // policy success rate per demo count
}

export interface Results {
  sample: boolean;
  demos: number[]; // human demo counts on the x axis
  series: Series[];
  ablation: { demos: number | null; bars: { key: string; label: string; success: Rate }[] };
  multiply_yield: { ours: Rate; mimicgen: [number, number] | null };
}

type Raw = Record<string, unknown>;

function rate(v: unknown, what: string): Rate {
  if (v === null) return null;
  if (typeof v !== "number" || !(v >= 0 && v <= 1)) throw new Error(`${what} must be a rate between 0 and 1 or null, got ${v}`);
  return v;
}

function object(v: unknown, what: string): Raw {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${what} must be an object`);
  return v as Raw;
}

export function parseResults(input: unknown): Results {
  const raw = object(input, "results");
  if (!Array.isArray(raw.demos) || !Array.isArray(raw.series)) throw new Error("results need demos and series");
  const demos = raw.demos as number[];
  const series = (raw.series as Raw[]).map((s) => {
    if (!Array.isArray(s.success) || s.success.length !== demos.length)
      throw new Error(`series ${s.key} needs one success rate per demo count`);
    return { key: String(s.key), label: String(s.label), success: s.success.map((v, i) => rate(v, `${s.key}[${i}]`)) };
  });

  const ablation = raw.ablation == null ? { demos: null, bars: [] } : object(raw.ablation, "ablation");
  const bars = (Array.isArray(ablation.bars) ? ablation.bars : []) as Raw[];
  const y = raw.multiply_yield == null ? {} : object(raw.multiply_yield, "multiply_yield");
  const mg = Array.isArray(y.mimicgen) ? y.mimicgen.map((v, i) => rate(v, `mimicgen[${i}]`)) : [];
  return {
    sample: raw.sample !== false,
    demos,
    series,
    ablation: {
      demos: typeof ablation.demos === "number" ? ablation.demos : null,
      bars: bars.map((b) => ({ key: String(b.key), label: String(b.label), success: rate(b.success ?? null, String(b.key)) })),
    },
    multiply_yield: {
      ours: rate(y.ours ?? null, "multiply_yield.ours"),
      mimicgen: mg.length === 2 && mg[0] !== null && mg[1] !== null ? [mg[0], mg[1]] : null,
    },
  };
}

export interface Box {
  width: number;
  height: number;
  pad: number;
}

export type Point = { x: number; y: number };

/** Evenly spaced x (demo counts are categories), success 0 at the bottom and 1 at the top; null stays null. */
export function chartPoints(values: Rate[], box: Box): (Point | null)[] {
  const w = box.width - 2 * box.pad;
  const h = box.height - 2 * box.pad;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => (v === null ? null : { x: box.pad + i * step, y: box.pad + (1 - v) * h }));
}

/** Consecutive measured points, so a line is never drawn through a pending one. */
export function chartRuns(points: (Point | null)[]): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    if (p) run.push(p);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}
