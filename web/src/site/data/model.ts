// The data showcase's model: one human-demo experiment as the backend reads it (GET /showcase/sets/{name},
// src/app/routers/showcase.py), the views a demo has (what the human did, the physics re-run, what SANT repaired,
// the multiplied variants), their verdicts in words, what the repair changed, and the shared clock's mapping to
// each view's step and footage frame. Pure.

export type Verification = {
  success: boolean;
  reasons: string[];
  duration: number | null;
  pathLength: number | null;
  maxContactForce: number | null;
  settleTime: number | null;
};

/** One repair: over a span (t0–t1) or at one moment (t), as the repairer wrote it. */
export type Repair = { op: string; t0?: number; t1?: number; t?: number; strength?: string };

export type RepairStage = {
  status: string;
  decision: string | null;
  diagnosisSource: string | null;
  outputId: string | null;
  repairs: Repair[];
  issues: { type: string; evidence: string; t0: number; t1: number }[];
  before: Verification | null;
  after: Verification | null;
};

/** A multiplied attempt; id is null when its episode wasn't kept (it still counts). */
export type Variant = { id: string | null; seed: number | null; success: boolean; reasons: string[]; frames: number };

export type DemoRow = {
  id: string;
  live: boolean;
  liveFrames: number;
  replay: (Verification & { frames: number }) | null;
  repair: RepairStage | null;
  repaired: { id: string; success: boolean; frames: number } | null;
  variants: Variant[];
};

export type ShowcaseSet = { name: string; input: string; repair: string | null; demos: DemoRow[] };

export type EvalCell = { cell: string; k: number; n: number };

export type SetSummary = {
  name: string;
  input: string;
  nDemos: number;
  replayVerified: number;
  repaired: number;
  variantsVerified: number;
  variantsTotal: number;
  evals: EvalCell[];
};

const fail = (what: string): never => {
  throw new Error(`the showcase's ${what} doesn't read`);
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function parseVerification(v: unknown): Verification | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  return {
    success: b.success === true,
    reasons: strs(b.reasons),
    duration: num(b.duration),
    pathLength: num(b.path_length),
    maxContactForce: num(b.max_contact_force),
    settleTime: num(b.settle_time),
  };
}

function parseRepair(v: unknown): RepairStage | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  return {
    status: String(b.status ?? "unknown"),
    decision: typeof b.decision === "string" ? b.decision : null,
    diagnosisSource: typeof b.diagnosis_source === "string" ? b.diagnosis_source : null,
    outputId: typeof b.output_id === "string" ? b.output_id : null,
    repairs: Array.isArray(b.repairs)
      ? (b.repairs as Record<string, unknown>[]).map((r) => {
          const out: Repair = { op: String(r.op) };
          for (const k of ["t0", "t1", "t"] as const) if (typeof r[k] === "number") out[k] = r[k] as number;
          if (typeof r.strength === "string") out.strength = r.strength;
          return out;
        })
      : [],
    issues: Array.isArray(b.issues)
      ? (b.issues as Record<string, unknown>[]).map((i) => ({ type: String(i.type), evidence: String(i.evidence ?? ""), t0: Number(i.t0), t1: Number(i.t1) }))
      : [],
    before: parseVerification(b.before),
    after: parseVerification(b.after),
  };
}

export function parseSet(body: unknown): ShowcaseSet {
  const b = (body ?? {}) as Record<string, unknown>;
  const demos = Array.isArray(b.demos) ? (b.demos as Record<string, unknown>[]) : fail("demos");
  return {
    name: String(b.name),
    input: String(b.input ?? "webcam"),
    repair: typeof b.repair === "string" ? b.repair : null,
    demos: demos.map((d) => {
      const replay = parseVerification(d.replay);
      const rep = d.repaired as Record<string, unknown> | null;
      return {
        id: String(d.id),
        live: d.live === true,
        liveFrames: Number(d.live_frames ?? 0),
        replay: replay ? { ...replay, frames: Number((d.replay as Record<string, unknown>).frames ?? 0) } : null,
        repair: parseRepair(d.repair),
        repaired: rep ? { id: String(rep.id), success: rep.success === true, frames: Number(rep.frames ?? 0) } : null,
        variants: Array.isArray(d.variants)
          ? (d.variants as Record<string, unknown>[]).map((v) => ({
              id: typeof v.id === "string" ? v.id : null,
              seed: num(v.seed),
              success: v.success === true,
              reasons: strs(v.reasons),
              frames: Number(v.frames ?? 0),
            }))
          : [],
      };
    }),
  };
}

export function parseSets(body: unknown): SetSummary[] {
  if (!Array.isArray(body)) fail("list of sets");
  return (body as Record<string, unknown>[]).map((s) => ({
    name: String(s.name),
    input: String(s.input ?? "webcam"),
    nDemos: Number(s.n_demos ?? 0),
    replayVerified: Number(s.replay_verified ?? 0),
    repaired: Number(s.repaired ?? 0),
    variantsVerified: Number(s.variants_verified ?? 0),
    variantsTotal: Number(s.variants_total ?? 0),
    evals: parseCells(s.evals),
  }));
}

export function parseCells(v: unknown): EvalCell[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]).map((c) => ({ cell: String(c.cell), k: Number(c.k), n: Number(c.n) })) : [];
}

// ---------------------------------------------------------------------------------------------- words

/** A demo by when it was recorded: "human_20261020183738_00ab" (its id holds the UTC time) → "Oct 20, 14:37:38" in
 *  the viewer's time zone (or timeZone, for tests). Any other id as it is. */
export function demoName(id: string, timeZone?: string): string {
  const m = /^human_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(id);
  if (!m) return id;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const when = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(when);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("month")} ${p("day")}, ${p("hour")}:${p("minute")}:${p("second")}`;
}

/** What each reason in a physics verdict means (demo_pipeline/success.py). */
const REASONS: Record<string, string> = {
  not_in_bin: "cube not in the bin",
  gripper_closed: "gripper still closed",
  not_settled: "cube still moving",
  too_slow: "too slow",
  collision: "arm pressed on the bin or table",
  dropped: "dropped the cube",
  high_release: "let go too high",
  unreachable: "out of the arm's reach",
};

export const reasonText = (r: string) => REASONS[r] ?? r.replace(/_/g, " ");

export const rejectedText = (reasons: string[]) => reasons.map(reasonText).join(", ") || "no reason given";

export type Verdict = { pass: boolean; text: string };

export function verdictOf(v: { success: boolean; reasons: string[] }): Verdict {
  if (v.success) return { pass: true, text: "Physics: verified" };
  return { pass: false, text: `Physics: failed (${rejectedText(v.reasons)})` };
}

const span = (r: Repair) => (r.t0 !== undefined && r.t1 !== undefined ? `${r.t0.toFixed(2)}–${r.t1.toFixed(2)} s` : r.t !== undefined ? `${r.t.toFixed(2)} s` : "");
const STRENGTH: Record<string, string> = { low: "light", med: "medium", high: "strong" };

export function repairText(r: Repair): string {
  switch (r.op) {
    case "trim":
      return `Trimmed to ${r.t0}–${r.t1} s (idle start and end cut)`;
    case "smooth":
      return `Smoothed ${span(r)}${r.strength ? ` (${STRENGTH[r.strength] ?? r.strength})` : ""}`;
    case "remove_pause":
      return `Removed a pause at ${span(r)}`;
    case "release_above_bin":
      return `Released the cube above the bin at ${span(r)}, off the rim`;
    case "recenter_grasp":
      return `Re-centred the grasp on the cube at ${span(r)}`;
    case "retime_grasp":
      return `Slowed the grasp at ${span(r)}: hover, slow last 4 cm, stop, close, hold, lift straight`;
    default:
      return span(r) ? `${r.op.replace(/_/g, " ")} at ${span(r)}` : r.op.replace(/_/g, " ");
  }
}

export type ChangeRow = { label: string; before: string; after: string; change: string };

const MEASURES: { key: keyof Verification; label: string; unit: string; digits: number }[] = [
  { key: "duration", label: "Duration", unit: "s", digits: 2 },
  { key: "pathLength", label: "Path length", unit: "m", digits: 3 },
  { key: "maxContactForce", label: "Peak contact force", unit: "N", digits: 0 },
  { key: "settleTime", label: "Settle time", unit: "s", digits: 2 },
];

/** Before and after the repair, measure by measure; nothing when the repair didn't produce a verified demo. */
export function whatChanged(r: RepairStage): ChangeRow[] {
  const { before, after } = r;
  if (!before || !after) return [];
  return MEASURES.flatMap(({ key, label, unit, digits }) => {
    const a = before[key] as number | null;
    const b = after[key] as number | null;
    if (a === null || b === null) return [];
    const fmt = (x: number) => `${x.toFixed(digits)} ${unit}`;
    // From the rounded numbers shown, so the change always adds up on screen.
    const d = Number((Number(b.toFixed(digits)) - Number(a.toFixed(digits))).toFixed(digits));
    const change = d === 0 ? "same" : `${d < 0 ? "−" : "+"}${Math.abs(d).toFixed(digits)} ${unit}`;
    return [{ label, before: fmt(a), after: fmt(b), change }];
  });
}

// ---------------------------------------------------------------------------------------------- views

export type ViewKind = "live" | "replay" | "repaired" | "variant";

export type View = {
  key: string;
  kind: ViewKind;
  /** The episode's demo id, in the main store (live) or the experiment's store. */
  id: string;
  live: boolean;
  label: string;
  verdict: Verdict | null;
  frames: number;
};

export const KIND_TEXT: Record<ViewKind, string> = {
  live: "What the human did, recorded live",
  replay: "The same path re-run with physics on",
  repaired: "What SANT repaired, re-verified",
  variant: "A multiplied copy: cube and bin moved",
};

export function viewsOf(d: DemoRow): View[] {
  const out: View[] = [];
  if (d.live) out.push({ key: "live", kind: "live", id: d.id, live: true, label: "Live", verdict: null, frames: d.liveFrames });
  if (d.replay) out.push({ key: "replay", kind: "replay", id: d.id, live: false, label: "Replay", verdict: verdictOf(d.replay), frames: d.replay.frames });
  if (d.repaired)
    out.push({ key: "repaired", kind: "repaired", id: d.repaired.id, live: false, label: "Repaired", verdict: verdictOf({ success: d.repaired.success, reasons: [] }), frames: d.repaired.frames });
  for (const v of d.variants)
    if (v.id)
      out.push({ key: v.id, kind: "variant", id: v.id, live: false, label: `Variant ${v.seed ?? v.id}`, verdict: verdictOf(v), frames: v.frames });
  return out;
}

// ---------------------------------------------------------------------------------------------- the clock

/** After the longest view ends, everything rests this long before the loop starts again. */
export const HOLD_S = 1.5;

export const stepAt = (t: number, nSteps: number, fps: number) => Math.max(0, Math.min(nSteps - 1, Math.floor(t * fps)));

export const clockDuration = (durations: number[]) => Math.max(0, ...durations) + HOLD_S;

export type Footage = { frames: number; stride: number; cols: number; tile: [number, number]; fps: number; url: string };

export function parseFootage(body: unknown): Footage {
  const b = (body ?? {}) as Record<string, unknown>;
  const tile = Array.isArray(b.tile) && b.tile.length === 2 ? (b.tile.map(Number) as [number, number]) : fail("footage tile");
  return {
    frames: Number(b.frames) > 0 ? Number(b.frames) : fail("footage frames"),
    stride: Math.max(1, Number(b.stride ?? 1)),
    cols: Math.max(1, Number(b.cols ?? 1)),
    tile,
    fps: Number(b.fps ?? 50),
    url: typeof b.url === "string" ? b.url : fail("footage url"),
  };
}

/** The sprite tile to show at clock time t (seconds): its index and its offset in the sheet, in pixels. */
export function footageAt(f: Footage, t: number): { index: number; x: number; y: number } {
  const index = Math.max(0, Math.min(f.frames - 1, Math.floor((t * f.fps) / f.stride)));
  return { index, x: (index % f.cols) * f.tile[0], y: Math.floor(index / f.cols) * f.tile[1] };
}
