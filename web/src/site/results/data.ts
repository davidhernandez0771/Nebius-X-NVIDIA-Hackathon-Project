// The measured results behind the Results page: ./results.json, checked in, every number copied
// from the note and lines cited next to it. A null count or p is not measured yet, and the page
// says Pending, never 0. parseResults checks the file, so a bad edit fails the tests, not the page.
import raw from "./results.json";

export type Source = { note: string; lines: string };

export type Arm = {
  key: string;
  label: string;
  detail: string | null;
  k: number | null;
  n: number;
  ci: [number, number] | null; // Wilson 95%, 0..1, as the note prints it
  highlight: boolean;
  source: Source | null;
  /** One character per scene, in seed order: "1" success, "0" failure. */
  outcomes: string | null;
  outcomesSource: Source | null;
  passes: number | null; // training passes over each example
  passesSource: Source | null;
  drops: { k: number; of: number; source: Source } | null;
};

export type Comparison = { a: string; b: string; p: number | null; verdict: string | null; source: Source | null };
export type Group = { label: string; arms: Arm[]; comparisons: Comparison[] };

export type Experiment = {
  id: string;
  title: string;
  question: string;
  setup: string | null;
  seeds: string;
  test: string;
  pending: string | null; // why it isn't measured yet
  groups: Group[];
  finding: string | null;
  caveats: string[];
  sources: Source[];
};

export type Results = {
  asOf: string;
  notes: Record<string, { name: string; path: string }>;
  experiments: Experiment[];
};

type Raw = Record<string, unknown>;

function object(v: unknown, what: string): Raw {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${what} must be an object`);
  return v as Raw;
}

function list(v: unknown, what: string): unknown[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error(`${what} must be a list`);
  return v;
}

const text = (v: unknown) => (typeof v === "string" ? v : null);
const unit = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1;
const count = (v: unknown, max: number) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

export function parseResults(input: unknown): Results {
  const r = object(input, "results");
  const notes = object(r.notes, "notes") as Results["notes"];
  for (const [key, n] of Object.entries(notes))
    if (typeof n?.name !== "string" || typeof n?.path !== "string") throw new Error(`note ${key} needs a name and a path`);

  const source = (v: unknown, what: string): Source | null => {
    if (v == null) return null;
    const s = object(v, what);
    if (typeof s.note !== "string" || !(s.note in notes)) throw new Error(`${what} cites ${s.note}, which isn't in notes`);
    if (typeof s.lines !== "string" || !/^\d+(–\d+)?(, \d+(–\d+)?)*$/.test(s.lines)) throw new Error(`${what} needs lines like "12–14, 20"`);
    return { note: s.note, lines: s.lines };
  };

  const arm = (input: unknown): Arm => {
    const a = object(input, "arm");
    const key = String(a.key);
    const n = a.n;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) throw new Error(`arm ${key} needs a positive n`);
    const k = a.k ?? null;
    if (k !== null && !count(k, n)) throw new Error(`arm ${key} needs a count from 0 to ${n} or null, got ${k}`);
    const ci = a.ci ?? null;
    if (ci !== null && !(Array.isArray(ci) && ci.length === 2 && ci.every(unit) && ci[0] <= ci[1]))
      throw new Error(`arm ${key} needs a CI of two rates or null`);
    if (k !== null && a.source == null) throw new Error(`arm ${key} is measured but cites no source`);
    const outcomes = text(a.outcomes);
    if (outcomes !== null && (!/^[01]+$/.test(outcomes) || outcomes.length !== n || [...outcomes].filter((c) => c === "1").length !== k))
      throw new Error(`arm ${key}'s outcomes must be ${n} 0s and 1s adding up to ${k}`);
    let drops: Arm["drops"] = null;
    if (a.drops != null) {
      const d = object(a.drops, `arm ${key} drops`);
      if (!count(d.of, n) || !count(d.k, Number(d.of))) throw new Error(`arm ${key} drops must be k of failures`);
      drops = { k: Number(d.k), of: Number(d.of), source: source(d.source, `arm ${key} drops`)! };
    }
    return {
      key,
      label: String(a.label),
      detail: text(a.detail),
      k: k as number | null,
      n,
      ci: ci as [number, number] | null,
      highlight: a.highlight === true,
      source: source(a.source, `arm ${key}`),
      outcomes,
      outcomesSource: source(a.outcomesSource, `arm ${key} outcomes`),
      passes: typeof a.passes === "number" ? a.passes : null,
      passesSource: source(a.passesSource, `arm ${key} passes`),
      drops,
    };
  };

  const group = (input: unknown): Group => {
    const g = object(input, "group");
    const arms = list(g.arms, "arms").map(arm);
    const keys = new Set(arms.map((a) => a.key));
    const comparisons = list(g.comparisons, "comparisons").map((input) => {
      const c = object(input, "comparison");
      for (const side of [c.a, c.b]) if (!keys.has(String(side))) throw new Error(`comparison names ${side}, which isn't an arm of ${g.label}`);
      const p = c.p ?? null;
      if (p !== null && !unit(p)) throw new Error(`p must be between 0 and 1 or null, got ${p}`);
      return { a: String(c.a), b: String(c.b), p: p as number | null, verdict: text(c.verdict), source: source(c.source, "comparison") };
    });
    return { label: String(g.label), arms, comparisons };
  };

  const experiments = list(r.experiments, "experiments").map((input): Experiment => {
    const e = object(input, "experiment");
    return {
      id: String(e.id),
      title: String(e.title),
      question: String(e.question),
      setup: text(e.setup),
      seeds: String(e.seeds),
      test: String(e.test),
      pending: text(e.pending),
      groups: list(e.groups, "groups").map(group),
      finding: text(e.finding),
      caveats: list(e.caveats, "caveats").map(String),
      sources: list(e.sources, "sources").map((s, i) => source(s, `${e.id} source ${i}`)!),
    };
  });
  return { asOf: String(r.as_of), notes, experiments };
}

export const RESULTS = parseResults(raw);

export function experiment(id: string): Experiment {
  const e = RESULTS.experiments.find((x) => x.id === id);
  if (!e) throw new Error(`results.json has no experiment ${id}`);
  return e;
}

/** A measured arm, by experiment and key; throws if it is missing or still pending. */
export function measured(id: string, key: string): Arm & { k: number; source: Source } {
  const a = experiment(id).groups.flatMap((g) => g.arms).find((x) => x.key === key);
  if (!a || a.k === null || !a.source) throw new Error(`${id}.${key} is not measured in results.json`);
  return a as Arm & { k: number; source: Source };
}

/** p as the notes print it: 0.0005, 0.65, 1.0. */
export const formatP = (p: number) => (Number.isInteger(p) ? p.toFixed(1) : String(p));

/** A rate with one decimal only when it needs one: 7.5%, 40%, 98.3%. */
export const formatPct = (v: number) => `${Math.round(v * 1000) / 10}%`;
