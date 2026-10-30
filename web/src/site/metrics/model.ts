// The /metrics page's numbers, derived and never typed: the climb and the teacher from the Results page's
// proofData.ts, the scripted-expert pair from results.json (data.ts), Stage A's checkpoint selection and Nemotron's
// run from the backend (GET /analysis/sources and /analysis/bigtest_final). This file only picks, formats and cites.
// The few sentences of its own (what this does not show, the selection caveat) paraphrase the big-test note at the
// lines cited next to each.
import { attemptState, verdictText, type Analysis, type Sources } from "../analysis/model";
import { measured } from "../results/data";
import { cite as factCite } from "../results/facts";
import { CLIMB, CLIMB_FOOTNOTE, CLIMB_FOOTNOTE_SOURCE, GOAL, TEACHER, proofCite, proofNoteUrl, type ProofSource } from "../results/proofData";

export type Pillar = {
  key: string;
  tag: string;
  label: string;
  series: "climb" | "scripted";
  k: number;
  n: number;
  ci: [number, number];
  seeds: string;
  metGoal: boolean;
  cite: string;
  href: string | null;
};

export const GOAL_RATE = GOAL.k / GOAL.n;

const V2 = CLIMB[CLIMB.length - 1];
const SCRIPTED_SEEDS = CLIMB[0].seeds; // the scripted pair ran on the same 40 scenes as raw/SANT/v1 (results.json "multiply")

function scripted(cell: string, tag: string): Pillar {
  const a = measured("multiply", cell);
  if (!a.ci) throw new Error(`results.json's multiply.${cell} has no CI`);
  return {
    key: cell,
    tag,
    label: `Scripted expert: ${a.label.replace(/^\+ /, "10 demos + ")}`,
    series: "scripted",
    k: a.k,
    n: a.n,
    ci: a.ci,
    seeds: SCRIPTED_SEEDS,
    metGoal: a.k / a.n >= GOAL_RATE,
    cite: factCite(a.source),
    href: null,
  };
}

/** The pillars of the hall: the climb, then the scripted-expert reference pair. */
export const PILLARS: Pillar[] = [
  ...CLIMB.map(
    (s): Pillar => ({
      key: s.key,
      tag: s.tag,
      label: s.label,
      series: "climb",
      k: s.k,
      n: s.n,
      ci: s.ci as [number, number],
      seeds: s.seeds,
      metGoal: s.k / s.n >= GOAL_RATE,
      cite: proofCite(s.source),
      href: proofNoteUrl(s.source),
    }),
  ),
  scripted("raw_10_30k", "Scripted"),
  scripted("raw_multiply_10_30k", "Scripted ×100"),
];

export const pctText = (k: number, n: number) => `${Math.round((100 * k) / n)}%`;

/** A Wilson interval: "0.60–0.86", or "60–86%". */
export function ciText([lo, hi]: readonly [number, number] | readonly number[], as: "unit" | "pct" = "unit"): string {
  if (as === "pct") return `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`;
  return `${lo.toFixed(2)}–${hi.toFixed(2)}`;
}

export const rateCi = (p: Pick<Pillar, "k" | "n" | "ci" | "seeds">) =>
  `${p.k}/${p.n} (${pctText(p.k, p.n)}), Wilson 95% CI ${ciText(p.ci)}, seeds ${p.seeds}`;

export const HEADLINE = {
  k: V2.k,
  n: V2.n,
  pct: pctText(V2.k, V2.n),
  ci: ciText(V2.ci),
  seeds: V2.seeds,
  goal: `${GOAL.k}/${GOAL.n}`,
  goalPct: pctText(GOAL.k, GOAL.n),
  sources: [V2.source, GOAL.source].map((s) => ({ cite: proofCite(s), href: proofNoteUrl(s) })),
};

export type Cited = { text: string; cite: string; href: string };
const cited = (text: string, source: ProofSource): Cited => ({ text, cite: proofCite(source), href: proofNoteUrl(source) });
const bigtest = (lines: string): ProofSource => ({ note: "bigtest", lines });

/** What the result does not show (big-test note, "What it shows, and what it doesn't"). */
export const NOT_SHOWN: Cited[] = [
  cited("One run, one training seed: how much a second training run would move the result is not measured.", bigtest("766")),
  cited("Which of v2's two changes made the difference (longer training or the gripper deadband): there was one combined arm and no ablation.", bigtest("761")),
  cited(CLIMB_FOOTNOTE, CLIMB_FOOTNOTE_SOURCE),
  cited(`The teacher comparison is one run per arm. ${TEACHER.caption}`, TEACHER.source),
  cited("Anything about the DAgger round: its stage was confounded and lost the pick.", bigtest("762")),
];

/** Read next to Stage A's checkpoint selection. */
export const SELECTION_NOTES: Cited[] = [
  cited(`Selection counts are inflated by the best-of-3 pick. Only the ${V2.n}-scene test estimates the rate.`, bigtest("660")),
  cited("Selection rose steadily with training length, which points at the longer training. Plausible, but untested.", bigtest("763")),
];

/** An SVG path through points, x in 0..xMax and y in 0..yMax, onto a w × h box (y up). */
export function teacherPath(pts: { x: number; y: number }[], { w, h, xMax, yMax }: { w: number; h: number; xMax: number; yMax: number }): string {
  const r = (v: number) => String(Math.round(v * 100) / 100);
  return pts.map((p, i) => `${i ? "L" : "M"} ${r((p.x / xMax) * w)} ${r(h - (p.y / yMax) * h)}`).join(" ");
}

// ------------------------------------------------------------------ from the backend

export type Selection = { steps: { label: string; k: number; n: number }[]; picked: string; seeds: string | null };

const steps = (label: string) => parseInt(label, 10);

/** Stage A's three checkpoints on its selection seeds: 60k and 120k from the source list, the final (picked)
 *  model from bigtest_final's non-test episodes. Null when the backend gave none. */
export function stageASelection(sources: Sources | null, final: Analysis | null): Selection | null {
  const out: Selection["steps"] = [];
  for (const s of sources?.sources ?? []) {
    const m = /^stage_a_(\d+k)$/.exec(s.id);
    if (m) out.push({ label: m[1], k: s.successes, n: s.episodes });
  }
  let seeds: string | null = null;
  if (final) {
    const sel = final.points.filter((p) => !p.test);
    const label = /Stage A, (\d+k) steps/.exec(final.detail)?.[1];
    if (sel.length && label) {
      out.push({ label, k: sel.filter((p) => p.success).length, n: sel.length });
      const ss = sel.map((p) => p.seed);
      seeds = `${Math.min(...ss)}–${Math.max(...ss)}`;
    }
  }
  if (!out.length) return null;
  out.sort((a, b) => steps(a.label) - steps(b.label));
  const best = out.reduce((a, b) => (b.k > a.k ? b : a));
  return { steps: out, picked: best.label, seeds };
}

export type AnalystSummary = { episodes: number; kept: number; sentBack: number; noAnswer: number; cost: string; model: string | null; verdict: string; weak: boolean };

/** Nemotron's cached run on the final model, as the strip reads it; null when it was never asked. */
export function analystSummary(a: Analysis): AnalystSummary | null {
  const n = a.nemotron;
  if (!n) return null;
  const states = n.attempts.map(attemptState);
  const count = (s: string) => states.filter((x) => x === s).length;
  const verdict = verdictText(n);
  return {
    episodes: a.episodes,
    kept: count("kept"),
    sentBack: count("sent back"),
    noAnswer: count("no answer"),
    cost: `$${n.cost_usd.toFixed(3)}`,
    model: n.model,
    verdict,
    weak: /weak lead/.test(verdict),
  };
}
