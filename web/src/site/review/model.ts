// The Review page's logic, kept out of the components: issue rows paired with their fixes, the
// detection-box tags, the verdict, and the timing of the scan and the raw -> perfected morph.
// Every string and number comes from the demo's own diagnosis and verification; nothing is made up.

import type { Issue, RepairOp, ReviewVerdict, StoredDiagnosis } from "../../pm/types";

type When = { t?: number | null; t0?: number | null; t1?: number | null };

export interface IssueRow {
  index: number;
  kind: "issue" | "gated" | "fix-only";
  type: string;
  evidence: string;
  t?: number | null;
  t0?: number | null;
  t1?: number | null;
  fixes: RepairOp[];
}

// Which repair answers which issue, from the fixed menu (src/demo_pipeline/repair.py).
const FIX_FOR: Record<string, string[]> = {
  pause: ["remove_pause"],
  idle_start_end: ["trim"],
  jitter: ["smooth"],
  slow: ["retime"],
  grasp_off_center: ["recenter_grasp"],
  rim_contact: ["replan_transit"],
};

function overlap(a: When, b: When): number {
  if (a.t0 == null || a.t1 == null || b.t0 == null || b.t1 == null) return 0;
  return Math.max(0, Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0));
}

function exact(a: When, b: When): boolean {
  return a.t0 != null && a.t0 === b.t0 && a.t1 === b.t1;
}

export function buildIssueRows(stored: StoredDiagnosis): IssueRow[] {
  const { issues, repairs } = stored.diagnosis;
  const used = new Set<number>();
  const rows: IssueRow[] = [];
  issues.forEach((issue: Issue) => {
    const ops = FIX_FOR[issue.type] ?? [];
    let best = -1;
    let bestScore = -1;
    repairs.forEach((r, k) => {
      if (used.has(k) || !ops.includes(r.op)) return;
      const score = (exact(issue, r) ? 1000 : 0) + overlap(issue, r);
      if (score > bestScore) [best, bestScore] = [k, score];
    });
    if (best >= 0) used.add(best);
    rows.push({ index: rows.length, kind: "issue", ...issue, fixes: best >= 0 ? [repairs[best]] : [] });
  });
  for (const g of stored.gated) rows.push({ index: rows.length, kind: "gated", type: "gated", evidence: g, fixes: [] });
  repairs.forEach((r, k) => {
    if (!used.has(k)) rows.push({ index: rows.length, kind: "fix-only", type: r.op, evidence: "", t: r.t, t0: r.t0, t1: r.t1, fixes: [r] });
  });
  return rows;
}

const TAGS: Record<string, string> = {
  pause: "PAUSE",
  idle_start_end: "IDLE",
  jitter: "JITTER",
  slow: "SLOW",
  grasp_off_center: "GRIP OFF-CENTER",
  rim_contact: "RIM CONTACT",
  bad_release: "BAD RELEASE",
  wrong_object: "WRONG OBJECT",
  drop: "DROP",
};
const TIMED = new Set(["pause", "idle_start_end"]);

/** A detection box's tag, e.g. "PAUSE 2.02 s": the issue's type plus its measured span when that is the point. */
export function detectionTag(issue: Pick<Issue, "type"> & When): string {
  const name = TAGS[issue.type] ?? issue.type.replace(/_/g, " ").toUpperCase();
  if (TIMED.has(issue.type) && issue.t0 != null && issue.t1 != null) return `${name} ${(issue.t1 - issue.t0).toFixed(2)} s`;
  return name;
}

export function formatSpan(w: When): string {
  if (w.t0 != null && w.t1 != null) return `${w.t0.toFixed(2)}–${w.t1.toFixed(2)} s`;
  if (w.t != null) return `at ${w.t.toFixed(2)} s`;
  return "whole demo";
}

/** True when the span covers (nearly) the whole demo, so a box for it would sit there all the time. */
export function isWholeDemo(w: When, duration: number): boolean {
  if (w.t0 == null || w.t1 == null) return w.t == null;
  return duration > 0 && (w.t1 - w.t0) / duration > 0.9;
}

/** The issues the playhead is inside, in row order. Whole-demo issues are left out (they get a corner tag). */
export function activeIssues(rows: IssueRow[], t: number, duration: number): IssueRow[] {
  return rows.filter((r) => {
    if (r.kind !== "issue" || isWholeDemo(r, duration)) return false;
    if (r.t0 != null && r.t1 != null) return t >= r.t0 && t <= r.t1;
    return r.t != null && Math.abs(t - r.t) < 0.25;
  });
}

export interface VerificationLike {
  success: boolean;
  reasons: string[];
  duration: number;
  path_length: number;
}

export type Physics =
  | { state: "unknown"; detail: string | null }
  | { state: "verified" | "failed"; duration: number; pathLength: number; reasons: string[] };

/** success.py's reason codes, in words (docs/design/nemotron-judge.md "the reasons in words"). */
const REASONS: Record<string, string> = {
  not_in_bin: "not in the bin",
  gripper_closed: "the gripper didn't open",
  not_settled: "the cube didn't settle",
  too_slow: "too slow",
  collision: "the arm hit the bin or table",
  dropped: "dropped the cube",
  high_release: "let go too high",
  unreachable: "the arm couldn't reach",
};
export const reasonWords = (code: string) => REASONS[code] ?? code.replace(/_/g, " ");

/** The judge's checks, in the contract's words for a failed one. */
const CHECK_WORDS = {
  same_object: "different object",
  same_goal: "different goal",
  same_order: "steps reversed",
  copy_completes: "didn't finish",
} as const;

export type NemotronLabel = { state: "ok"; task: string } | { state: "unavailable"; error: string | null } | { state: "none" };

export type MatchLine =
  | { state: "yes" | "no"; reason: string | null; failed: string[]; judgedOn: string | null }
  | { state: "not_checked"; reason: string | null }
  | { state: "unavailable"; reason: string | null }
  | { state: "none" };

export interface FixLine {
  op: string;
  span: string;
  /** The op's parameters other than its times, e.g. "strength med". */
  params: string;
}

export interface Verdict {
  physics: Physics;
  /** The diagnosis's label, shown when Nemotron hasn't labelled the demo. */
  label: { text: string; author: string } | null;
  nemotron: NemotronLabel;
  match: MatchLine;
  /** Nemotron and physics disagree about the outcome; physics decides. */
  conflict: string | null;
  /** Where the label and match came from, e.g. "review_verdict.json". */
  verdictSource: string | null;
}

export function verdictOf({
  stored,
  verification,
  card = null,
  physicsDetail = null,
}: {
  stored: StoredDiagnosis | null;
  verification: VerificationLike | null;
  card?: { verdict: ReviewVerdict; judgedOn: string | null; source: string } | null;
  physicsDetail?: string | null;
}): Verdict {
  const physics: Physics = verification
    ? {
        state: verification.success ? "verified" : "failed",
        duration: verification.duration,
        pathLength: verification.path_length,
        reasons: verification.reasons,
      }
    : { state: "unknown", detail: physicsDetail };
  const label = stored
    ? { text: stored.diagnosis.label, author: stored.source === "nemotron" ? stored.model_id ?? "Nemotron" : "rules template" }
    : null;
  const v = card?.verdict;
  // "Unavailable" is never shown as "no", and nothing stored is "not yet" (docs/design/nemotron-judge.md rule 5).
  const nemotron: NemotronLabel = !v
    ? { state: "none" }
    : v.label.status === "ok" && v.label.task
      ? { state: "ok", task: v.label.task }
      : { state: "unavailable", error: v.label.error };
  let match: MatchLine = { state: "none" };
  if (v) {
    const m = v.match;
    if (m.status === "yes" || m.status === "no") {
      const failed = m.checks ? (Object.keys(CHECK_WORDS) as (keyof typeof CHECK_WORDS)[]).filter((k) => !m.checks![k]).map((k) => CHECK_WORDS[k]) : [];
      match = { state: m.status, reason: m.reason, failed, judgedOn: card!.judgedOn };
    } else match = { state: m.status, reason: m.reason };
  }
  return { physics, label, nemotron, match, conflict: v?.conflict ?? null, verdictSource: card?.source ?? null };
}

/** The fixes Neaten applied, in the order it applied them (the passport's), each with its span in demo seconds. */
export function fixLines(applied: RepairOp[]): FixLine[] {
  return applied.map((r) => {
    const { op, t, t0, t1, ...rest } = r;
    return {
      op,
      span: formatSpan({ t, t0, t1 }),
      params: Object.entries(rest)
        .map(([k, val]) => `${k.replace(/_/g, " ")} ${String(val)}`)
        .join(", "),
    };
  });
}

/** An ISO timestamp as "2026-10-16 20:17 UTC"; the raw string if it doesn't parse. */
export function formatWhen(iso: string): string {
  const d = new Date(iso.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function fixedSummary(rows: IssueRow[]) {
  return {
    issues: rows.filter((r) => r.kind === "issue").length,
    fixes: rows.reduce((n, r) => n + r.fixes.length, 0),
    gated: rows.filter((r) => r.kind === "gated").length,
  };
}

const MAX_BLOCK = 14;

/** The raw -> perfected morph at progress p (0..1): mosaic blocks grow, the frame swaps at 0.5, then resolve. */
export function morphAt(p: number) {
  const q = Math.min(1, Math.max(0, p));
  if (q === 0 || q === 1) return { block: 1, showAfter: q === 1, glitch: 0 };
  const s = Math.sin(Math.PI * q);
  return { block: 1 + Math.round((MAX_BLOCK - 1) * s), showAfter: q >= 0.5, glitch: s };
}

const GLYPHS = "░▒/<>_-=01";

/** Text that settles left to right: characters before p * length are final, the rest are glyph noise. */
export function scramble(s: string, p: number, rand: () => number = Math.random): string {
  return s
    .split("")
    .map((c, k) => (c === " " || k / s.length < p ? c : GLYPHS[Math.floor(rand() * GLYPHS.length) % GLYPHS.length]))
    .join("");
}
