// The failure analyst's data as the page reads it (GET /analysis/{id}, app/routers/analysis.py), and the pure helpers
// the page draws with: the workspace's extents, the scene map's scale, the outcome classes and the claim verdicts.

export type Range = [number, number];

export type Region = {
  name: string;
  targets: string[];
  cube_x: Range;
  cube_y: Range;
  cube_yaw_deg: Range;
  bin_x: Range;
  bin_y: Range;
  share: number;
  rationale: string;
};

export type Recipe = {
  summary: string;
  hypotheses?: { claim: string; evidence_seeds: number[] }[];
  mechanism?: { feature: string; direction: string; explanation: string }[];
  fixes?: { lever: string; rationale: string }[];
  regions: Region[];
  uniform_share: number;
};

export type Support = {
  region: string;
  episodes_inside: number;
  target_failures_inside: number;
  target_failures_total: number;
  coverage: number;
  rate_inside: number;
  rate_overall: number;
  p_value: number;
};

export type Attempt = {
  sample: number;
  think: boolean;
  accepted: boolean;
  errors: string[];
  claimed: { summary: string; regions: string[]; fixes: string[]; mechanism: string[] } | null;
  excerpt: string | null;
};

export type Nemotron = {
  recipe: Recipe | null;
  support: Support[] | null;
  agreement: number | null;
  candidates: number;
  k: number;
  calls: number;
  cost_usd: number;
  model: string | null;
  api_errors: number;
  attempts: Attempt[];
  ran_at?: string | null;
};

export type Point = {
  seed: number;
  success: boolean;
  primary: string | null;
  reasons: string[];
  cube: [number, number];
  bin: [number, number];
  cube_yaw_deg: number;
  test: boolean;
};

export type TableRow = { axis: string; bin: Range; n: number; successes: number; failures: Record<string, number> };

export type Analysis = {
  id: string;
  title: string;
  detail: string;
  episodes: number;
  successes: number;
  failures: number;
  post_hoc: boolean;
  untraced: boolean;
  failure_counts: Record<string, number>;
  failure_table: TableRow[];
  points: Point[];
  rules: { recipe: Recipe; support: Support[] } | null;
  nemotron: Nemotron | null;
  live_enabled: boolean;
};

export type SourceRow = { id: string; title: string; detail: string; episodes: number; successes: number; post_hoc: boolean; cached: boolean };
export type Sources = { live_enabled: boolean; sources: SourceRow[] };

/** The outcomes the map colours, in a fixed order (never cycled): success, then the failure classes seen. */
export type Outcome = "success" | "dropped" | "collision" | "other";
export const OUTCOMES: { id: Outcome; label: string; shape: "circle" | "triangle" | "square" | "diamond" }[] = [
  { id: "success", label: "Succeeded", shape: "circle" },
  { id: "dropped", label: "Dropped the cube", shape: "triangle" },
  { id: "collision", label: "Collision", shape: "square" },
  { id: "other", label: "Other failure", shape: "diamond" },
];

export function outcomeOf(p: Pick<Point, "success" | "primary">): Outcome {
  if (p.success) return "success";
  if (p.primary === "dropped") return "dropped";
  if (p.primary === "collision" || p.primary === "collision_table" || p.primary === "collision_bin") return "collision";
  return "other";
}

/** An axis's full range from the per-axis table (its first bin's low edge to its last bin's high edge). */
export function extent(table: TableRow[], axis: string): Range | null {
  const rows = table.filter((r) => r.axis === axis);
  if (!rows.length) return null;
  return [Math.min(...rows.map((r) => r.bin[0])), Math.max(...rows.map((r) => r.bin[1]))];
}

/** A linear map from a value range onto pixels. */
export function scale(domain: Range, range: Range): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/** Ticks every `step` metres inside a range, rounded so 0.1 + 0.2 shows as 0.3. */
export function ticks([lo, hi]: Range, step = 0.1): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

export function pText(p: number): string {
  if (p < 0.001) return "p < 0.001";
  return `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`;
}

/** The headline of Nemotron's verdict: what it settled on after the checks. */
export function verdictText(n: Nemotron | null): string {
  if (!n) return "Not asked yet";
  if (!n.recipe) return n.api_errors && n.api_errors >= n.k ? "The model service did not answer" : "No recipe passed the checks";
  const r = n.recipe;
  if (!r.regions.length && !(r.fixes ?? []).length) return "Keep the data as it is";
  const parts = [...r.regions.map((g) => `more scenes in ${g.name.replace(/_/g, " ")}`), ...(r.fixes ?? []).map((f) => f.lever.replace(/_/g, " "))];
  // a region that only just passed the p <= 0.1 check is a lead to test on fresh seeds, not a finding
  const weakest = Math.max(...(n.support ?? []).map((s) => s.p_value), 0);
  return weakest > 0.05 ? `${parts.join(" · ")} (weak lead, one-sided ${pText(weakest)})` : parts.join(" · ");
}

/** The attempts as the claims table shows them: sent back, kept, or lost to the service. */
export function attemptState(a: Attempt): "kept" | "sent back" | "no answer" {
  if (a.accepted) return "kept";
  if (a.errors.length === 1 && a.errors[0] === "the model service did not answer") return "no answer";
  return "sent back";
}

export const axisLabel: Record<string, string> = {
  cube_x: "cube x",
  cube_y: "cube y",
  cube_yaw_deg: "cube yaw",
  bin_x: "bin x",
  bin_y: "bin y",
};
