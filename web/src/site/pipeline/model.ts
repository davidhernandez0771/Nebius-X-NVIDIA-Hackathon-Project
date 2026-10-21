// The SANT pipeline after Record, as the site follows it live (/pipeline): a run's stages (Check, Repair, Multiply,
// Train, Evaluate, Export), each with its progress and time left, the GPU queue, and what each stage produced. The
// backend is /pipeline (pm/pipeline-api); this reads its snapshot and applies its live events (SSE), tolerating
// missing parts, so the pages work while it is still being built (stub.ts plays a run until then). Pure.

export const PIPELINE_STAGES = [
  { id: "check", label: "Check", blurb: "Physics replays each demo and gives its verdict." },
  { id: "repair", label: "Repair", blurb: "Neaten fixes what the check found, and re-verifies." },
  { id: "multiply", label: "Multiply", blurb: "Each repaired demo becomes verified variants: new cube and bin places." },
  { id: "train", label: "Train", blurb: "A policy learns from the verified demos." },
  { id: "evaluate", label: "Evaluate", blurb: "The policy runs on unseen scenes, seed by seed." },
  { id: "export", label: "Export", blurb: "Your data: the dataset, the Robota export and the report." },
] as const;

/** The teacher recipe (pm/pipeline-api 719d278): T3's RL teacher, its gate, T6's distillation into a camera policy. */
export const TEACHER_STAGES = [
  { id: "teacher", label: "Teacher", blurb: "RL trains a teacher in Isaac Lab, from the human run's start states." },
  { id: "gate", label: "Gate", blurb: "The teacher runs unseen seeds, and SANT's physics replays each: it must pass before it teaches." },
  { id: "distill", label: "Distill", blurb: "Round 0: the teacher's rollouts become the data, a camera policy (ACT) learns it, the best checkpoint is chosen." },
  { id: "dagger", label: "DAgger", blurb: "Round 1, when asked: the student drives and the teacher labels where it goes wrong." },
  { id: "export", label: "Export", blurb: "Your data: the student's dataset and checkpoint, and the report." },
] as const;

export type RunKind = "demos" | "teacher";
export type DemosStageId = (typeof PIPELINE_STAGES)[number]["id"];
export type StageId = DemosStageId | (typeof TEACHER_STAGES)[number]["id"];
export type StageMeta = { id: StageId; label: string; blurb: string };

/** A run's stages, in order: the demos recipe's six, or the teacher recipe's five. */
export const stagesFor = (kind: RunKind): readonly StageMeta[] => (kind === "teacher" ? TEACHER_STAGES : PIPELINE_STAGES);
/** One stage's label and blurb, whichever recipe it belongs to. */
export const stageMeta = (id: StageId): StageMeta => [...PIPELINE_STAGES, ...TEACHER_STAGES].find((s) => s.id === id)!;
export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type Stage = {
  id: StageId;
  status: StageStatus;
  progress: number;
  eta_s: number | null;
  started: number | null;
  finished: number | null;
  detail: string | null;
  /** Its items so far ("3 of 10 demos"), when it counts them. */
  items: { done: number; total: number; unit: string } | null;
  elapsed_s: number | null;
  /** What its time estimate rests on ("physics 23 s/demo, measured: median of 68"). */
  eta_basis: string | null;
};

export type Gpu = { state: "idle" | "queued" | "running"; position: number | null; holder: string | null };

export type Metrics = { duration?: number; path_length?: number; max_contact_force?: number; settle_time?: number };
export type CheckRow = { demo: string; success: boolean; reasons: string[]; frames: number } & Metrics;
export type RepairRow = {
  demo: string;
  status: string;
  repairs: { op: string; t0?: number; t1?: number; t?: number }[];
  before: Metrics | null;
  after: Metrics | null;
  output_id: string | null;
};
export type VariantRow = { id: string; source: string; seed: number | null; success: boolean; reasons: string[]; frames: number };
export type Train = { step: number; steps: number; loss: [number, number][]; checkpoints: { step: number; name: string }[]; eta_s: number | null; cell: string | null };
export type EvalRow = { seed: number; success: boolean; reasons: string[]; cell: string | null };
export type TeacherRound = {
  round: number;
  /** rollouts, grid, train, select, done; or stopped (DAgger's stop rule). */
  phase: string;
  rollouts: { done: number; total: number; successes: number };
  /** The checkpoint chosen (T6's selection), once chosen. */
  chosen_step: number | null;
  /** DAgger's stop rule ended the round. */
  stopped: boolean;
};
export type Teacher = {
  iteration: number;
  iterations: number;
  human_run: string;
  teacher_n: number;
  dagger: boolean;
  smoke: boolean;
  gate: { successes: number | null; n: number | null; min: number | null; seeds: [number, number] | null; passed: boolean | null };
  rounds: TeacherRound[];
};
export type Artifact = { name: string; kind: "dataset" | "robota" | "report" | "checkpoint" | "other"; bytes: number; url: string; sha256: string | null; note: string | null };

export type RunState = {
  id: string;
  kind: RunKind;
  /** A teacher run's own state (the teacher recipe), else null. */
  teacher: Teacher | null;
  name: string;
  created: string;
  status: RunStatus;
  /** Why it stopped or was refused ("stopped before train; resumable"). */
  detail: string | null;
  resumable: boolean;
  gpu: Gpu;
  elapsed_s: number | null;
  remaining_s: number | null;
  stages: Stage[];
  check: CheckRow[];
  repair: RepairRow[];
  variants: VariantRow[];
  train: Train;
  evaluate: { seeds: EvalRow[]; planned: number };
  artifacts: Artifact[];
  /** The run log's last lines. */
  log: string[];
  /** How many demos it runs on. */
  demos: number;
  /** A dry run's plan: what the full run would take, in seconds. */
  plan_s: number | null;
};

export type RunSummary = { id: string; name: string; created: string; status: RunStatus; stage: string; demos: number; detail: string | null; resumable: boolean; kind: RunKind };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d: number | null = null): number | null => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);

const RUN_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
const STAGE_STATUSES = ["pending", "running", "done", "failed", "skipped"] as const;
const ARTIFACT_KINDS = ["dataset", "robota", "report", "checkpoint", "other"] as const;

const metrics = (o: Obj): Metrics => {
  const m: Metrics = {};
  for (const k of ["duration", "path_length", "max_contact_force", "settle_time"] as const) {
    const v = num(o[k]);
    if (v !== null) m[k] = v;
  }
  return m;
};

const pendingStage = (id: StageId): Stage => ({ id, status: "pending", progress: 0, eta_s: null, started: null, finished: null, detail: null, items: null, elapsed_s: null, eta_basis: null });

const itemsOf = (v: unknown): Stage["items"] => {
  const o = obj(v);
  const done = num(o.done), total = num(o.total);
  return done === null || total === null ? null : { done, total, unit: str(o.unit) };
};

/** How many log lines a run keeps. */
const LOG_LINES = 40;

function stagePatch(s: Stage, o: Obj): Stage {
  return {
    ...s,
    status: "status" in o ? oneOf(o.status, STAGE_STATUSES, s.status) : s.status,
    progress: "progress" in o ? Math.min(1, Math.max(0, num(o.progress, 0)!)) : s.progress,
    eta_s: "eta_s" in o ? num(o.eta_s) : s.eta_s,
    started: "started" in o ? num(o.started) : s.started,
    finished: "finished" in o ? num(o.finished) : s.finished,
    detail: "detail" in o ? (typeof o.detail === "string" ? o.detail : null) : s.detail,
    items: "items" in o ? itemsOf(o.items) : s.items,
    elapsed_s: "elapsed_s" in o ? num(o.elapsed_s) : s.elapsed_s,
    eta_basis: "eta_basis" in o ? (typeof o.eta_basis === "string" ? o.eta_basis : null) : s.eta_basis,
  };
}

const checkRow = (o: Obj): CheckRow => ({ demo: str(o.demo), success: o.success === true, reasons: strs(o.reasons), frames: num(o.frames, 0)!, ...metrics(o) });
const repairRow = (o: Obj): RepairRow => ({
  demo: str(o.demo),
  status: str(o.status, "pending"),
  repairs: arr(o.repairs).map((r) => {
    const x = obj(r);
    return { op: str(x.op), ...(num(x.t0) !== null ? { t0: num(x.t0)! } : {}), ...(num(x.t1) !== null ? { t1: num(x.t1)! } : {}), ...(num(x.t) !== null ? { t: num(x.t)! } : {}) };
  }),
  before: o.before ? metrics(obj(o.before)) : null,
  after: o.after ? metrics(obj(o.after)) : null,
  output_id: typeof o.output_id === "string" ? o.output_id : null,
});
// A failed variant has no episode id: it gets the name T5 gives it (<source>_m<seed>), so every row has its own.
const variantRow = (o: Obj): VariantRow => ({ id: str(o.id) || `${str(o.source)}_m${num(o.seed) ?? "?"}`, source: str(o.source), seed: num(o.seed), success: o.success === true, reasons: strs(o.reasons), frames: num(o.frames, 0)! });
const evalRow = (o: Obj): EvalRow => ({ seed: num(o.seed, 0)!, success: o.success === true, reasons: strs(o.reasons), cell: typeof o.cell === "string" ? o.cell : null });
const artifact = (o: Obj): Artifact => ({
  name: str(o.name),
  kind: oneOf(o.kind, ARTIFACT_KINDS, "other"),
  bytes: num(o.bytes, 0)!,
  url: str(o.url),
  sha256: typeof o.sha256 === "string" ? o.sha256 : null,
  note: typeof o.note === "string" ? o.note : null,
});
const gpuOf = (o: Obj): Gpu => ({ state: oneOf(o.state, ["idle", "queued", "running"] as const, "idle"), position: num(o.position), holder: typeof o.holder === "string" ? o.holder : null });

const kindOf = (v: unknown): RunKind => (v === "teacher" ? "teacher" : "demos");

const teacherOf = (o: Obj): Teacher => {
  const g = obj(o.gate);
  const seeds = arr(g.seeds);
  return {
    iteration: num(o.iteration, 0)!,
    iterations: num(o.iterations, 0)!,
    human_run: str(o.human_run),
    teacher_n: num(o.teacher_n, 0)!,
    dagger: o.dagger === true,
    smoke: o.smoke === true,
    gate: {
      successes: num(g.successes),
      n: num(g.n),
      min: num(g.min),
      seeds: seeds.length === 2 && num(seeds[0]) !== null && num(seeds[1]) !== null ? [num(seeds[0])!, num(seeds[1])!] : null,
      passed: typeof g.passed === "boolean" ? g.passed : null,
    },
    rounds: arr(o.rounds).map((x) => {
      const r = obj(x), ro = obj(r.rollouts);
      return {
        round: num(r.round, 0)!,
        phase: str(r.phase),
        rollouts: { done: num(ro.done, 0)!, total: num(ro.total, 0)!, successes: num(ro.successes, 0)! },
        chosen_step: num(obj(r.selection).chosen_step),
        stopped: r.phase === "stopped" || obj(r.decision).stop === true,
      };
    }),
  };
};

export function emptyRun(id: string, kind: RunKind = "demos"): RunState {
  return {
    id,
    kind,
    teacher: null,
    name: "",
    created: "",
    status: "queued",
    detail: null,
    resumable: false,
    gpu: { state: "idle", position: null, holder: null },
    elapsed_s: null,
    remaining_s: null,
    stages: stagesFor(kind).map((s) => pendingStage(s.id)),
    check: [],
    repair: [],
    variants: [],
    train: { step: 0, steps: 0, loss: [], checkpoints: [], eta_s: null, cell: null },
    evaluate: { seeds: [], planned: 0 },
    artifacts: [],
    log: [],
    demos: 0,
    plan_s: null,
  };
}

/** A run's snapshot (GET /pipeline/runs/{id}, or the stream's first event). */
export function parseRun(body: unknown): RunState {
  const o = obj(body);
  const base = emptyRun(str(o.id), kindOf(o.kind));
  const given = new Map(arr(o.stages).map((s) => [str(obj(s).id), obj(s)] as const));
  const t = obj(o.train);
  const e = obj(o.evaluate);
  return {
    ...base,
    name: str(o.name),
    created: str(o.created),
    status: oneOf(o.status, RUN_STATUSES, "queued"),
    detail: typeof o.detail === "string" ? o.detail : null,
    resumable: o.resumable === true,
    teacher: o.teacher && typeof o.teacher === "object" ? teacherOf(obj(o.teacher)) : null,
    gpu: gpuOf(obj(o.gpu)),
    elapsed_s: num(o.elapsed_s),
    remaining_s: num(o.remaining_s),
    stages: base.stages.map((s) => (given.has(s.id) ? stagePatch(s, given.get(s.id)!) : s)),
    check: arr(o.check).map((x) => checkRow(obj(x))),
    repair: arr(o.repair).map((x) => repairRow(obj(x))),
    variants: arr(o.variants).map((x) => variantRow(obj(x))),
    train: {
      step: num(t.step, 0)!,
      steps: num(t.steps, 0)!,
      loss: arr(t.loss).map((p) => arr(p)).filter((p) => p.length === 2).map((p) => [num(p[0], 0)!, num(p[1], 0)!] as [number, number]),
      checkpoints: arr(t.checkpoints).map((c) => ({ step: num(obj(c).step, 0)!, name: str(obj(c).name) })),
      eta_s: num(t.eta_s),
      cell: typeof t.cell === "string" ? t.cell : null,
    },
    evaluate: { seeds: arr(e.seeds).map((x) => evalRow(obj(x))), planned: num(e.planned, 0)! },
    artifacts: arr(o.artifacts).map((x) => artifact(obj(x))),
    log: strs(o.log).slice(-LOG_LINES),
    demos: num(o.demos, 0)!,
    plan_s: num(o.plan_s),
  };
}

export function parseRuns(body: unknown): RunSummary[] {
  return arr(obj(body).runs).map((r) => {
    const o = obj(r);
    return {
      id: str(o.id),
      name: str(o.name),
      created: str(o.created),
      status: oneOf(o.status, RUN_STATUSES, "queued"),
      stage: str(o.stage),
      demos: num(o.demos, 0)!,
      detail: typeof o.detail === "string" ? o.detail : null,
      resumable: o.resumable === true,
      kind: kindOf(o.kind),
    };
  });
}

export type RunEvent = { type: string; [k: string]: unknown };

export function parseRunEvent(data: string): RunEvent | null {
  try {
    const e = JSON.parse(data);
    return e && typeof e === "object" && typeof e.type === "string" ? (e as RunEvent) : null;
  } catch {
    return null;
  }
}

const lossPoints = (v: unknown): [number, number][] =>
  arr(v).map((p) => arr(p)).filter((p) => p.length === 2 && num(p[0]) !== null && num(p[1]) !== null).map((p) => [num(p[0])!, num(p[1])!]);

/** Both cells (raw_N, perfected_multiply_N) run the same seeds. */
const evalKey = (r: EvalRow) => `${r.cell ?? ""}:${r.seed}`;

const upsert = <T>(rows: T[], row: T, key: (r: T) => string | number): T[] => {
  const i = rows.findIndex((r) => key(r) === key(row));
  return i < 0 ? [...rows, row] : rows.map((r, j) => (j === i ? row : r));
};

/** One live event applied to the run (unknown ones leave it as it was). */
export function applyRunEvent(s: RunState, e: RunEvent): RunState {
  switch (e.type) {
    case "snapshot":
      return parseRun(e);
    case "stage":
      return { ...s, stages: s.stages.map((st) => (st.id === e.stage ? stagePatch(st, e) : st)) };
    case "gpu":
      return { ...s, gpu: gpuOf(e) };
    case "teacher":
      return { ...s, teacher: teacherOf(e) };
    case "check":
      return { ...s, check: upsert(s.check, checkRow(e), (r) => r.demo) };
    case "repair":
      return { ...s, repair: upsert(s.repair, repairRow(e), (r) => r.demo) };
    case "variant":
      return { ...s, variants: upsert(s.variants, variantRow(e), (r) => r.id) };
    case "train": {
      const step = num(e.step, s.train.step)!;
      const cell = typeof e.cell === "string" ? e.cell : s.train.cell;
      // A new cell trains from step 0: its own curve and checkpoints.
      const fresh = cell !== s.train.cell && s.train.cell !== null;
      // The new points (T5's loss_points, or loss as a list), else the latest loss (a number) at this step.
      const loss = num(e.loss);
      const given = "loss_points" in e ? lossPoints(e.loss_points) : Array.isArray(e.loss) ? lossPoints(e.loss) : loss !== null ? [[step, loss] as [number, number]] : [];
      const at = new Set(given.map(([k]) => k));
      const kept = fresh ? [] : s.train.loss.filter(([k]) => !at.has(k));
      return {
        ...s,
        train: {
          ...s.train,
          step,
          steps: num(e.steps, s.train.steps)!,
          eta_s: "eta_s" in e ? num(e.eta_s) : s.train.eta_s,
          cell,
          loss: [...kept, ...given].sort((a, b) => a[0] - b[0]),
          checkpoints: fresh ? [] : s.train.checkpoints,
        },
      };
    }
    case "checkpoint":
      return { ...s, train: { ...s.train, checkpoints: upsert(s.train.checkpoints, { step: num(e.step, 0)!, name: str(e.name) }, (c) => c.step) } };
    case "evaluate":
      return { ...s, evaluate: { ...s.evaluate, seeds: upsert(s.evaluate.seeds, evalRow(e), evalKey) } };
    case "artifact":
      return { ...s, artifacts: upsert(s.artifacts, artifact(e), (a) => a.name) };
    case "run":
      return {
        ...s,
        status: oneOf(e.status, RUN_STATUSES, s.status),
        detail: "detail" in e ? (typeof e.detail === "string" ? e.detail : null) : s.detail,
        resumable: "resumable" in e ? e.resumable === true : s.resumable,
        elapsed_s: "elapsed_s" in e ? num(e.elapsed_s) : s.elapsed_s,
        remaining_s: "remaining_s" in e ? num(e.remaining_s) : s.remaining_s,
      };
    case "log":
      return typeof e.line === "string" ? { ...s, log: [...s.log, e.line].slice(-LOG_LINES) } : s;
    case "end":
      return { ...s, status: oneOf(e.status, RUN_STATUSES, "done"), detail: typeof e.detail === "string" ? e.detail : s.detail };
    default:
      return s;
  }
}

export const stageOf = (r: RunState, id: StageId): Stage => r.stages.find((s) => s.id === id) ?? pendingStage(id);

/** "42 s", "3 min 05 s", "25 min", "1 h 12 min"; "—" when unknown. */
export function formatDuration(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "—";
  const t = Math.max(0, Math.round(s));
  if (t < 60) return `${t} s`;
  if (t < 600) return `${Math.floor(t / 60)} min ${String(t % 60).padStart(2, "0")} s`;
  if (t < 3600) return `${Math.round(t / 60)} min`;
  return `${Math.floor(t / 3600)} h ${String(Math.round((t % 3600) / 60)).padStart(2, "0")} min`;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

export type Bar = { current: StageId | null; waiting: string | null; elapsed: string; remaining: string };

/** What the pipeline bar says: the stage running now, time spent and left, and the GPU queue when it waits. */
export function barOf(r: RunState): Bar {
  const finished = r.status === "done" || r.status === "failed" || r.status === "cancelled";
  const current = finished ? null : (r.stages.find((s) => s.status === "running") ?? r.stages.find((s) => s.status === "pending"))?.id ?? null;
  const g = r.gpu;
  const why = [g.position ? `${ordinal(g.position)} in line` : "", g.holder ? `it's busy: ${g.holder}` : ""].filter(Boolean).join("; ");
  const waiting = g.state === "queued" ? `Waiting for the GPU${why ? ` (${why})` : ""}` : null;
  const remaining = r.plan_s !== null && r.status === "done" ? `dry run: about ${formatDuration(r.plan_s)}` : finished ? r.status : formatDuration(r.remaining_s);
  return { current, waiting, elapsed: formatDuration(r.elapsed_s), remaining };
}

/** Successes out of the seeds run so far, and of those planned. */
export function evalScore(r: RunState): { k: number; run: number; planned: number } {
  return { k: r.evaluate.seeds.filter((s) => s.success).length, run: r.evaluate.seeds.length, planned: r.evaluate.planned };
}

const CELL_LABELS: [RegExp, string][] = [
  [/^raw_/, "Raw demos"],
  [/^perfected_multiply_/, "SANT (repaired + multiplied)"],
];

/** The evaluation per cell (raw demos against SANT's data), in the order they appear; planned split between them. */
export function evalCells(r: RunState): { cell: string; label: string; k: number; run: number; planned: number }[] {
  const cells = [...new Set(r.evaluate.seeds.map((s) => s.cell ?? ""))];
  return cells.map((cell) => {
    const rows = r.evaluate.seeds.filter((s) => (s.cell ?? "") === cell);
    return {
      cell,
      label: CELL_LABELS.find(([re]) => re.test(cell))?.[1] ?? (cell || "Policy"),
      k: rows.filter((s) => s.success).length,
      run: rows.length,
      planned: Math.round(r.evaluate.planned / Math.max(1, cells.length)),
    };
  });
}

/** The loss curve as an SVG path in a w x h box: steps along x, log(loss) down y (high loss at the top). */
export function lossPath(points: readonly [number, number][], w: number, h: number): string {
  const p = points.filter(([, l]) => l > 0);
  if (p.length === 0) return "";
  const x0 = p[0][0], x1 = Math.max(x0 + 1, p[p.length - 1][0]);
  const ls = p.map(([, l]) => Math.log10(l));
  const hi = Math.max(...ls), lo = Math.min(...ls);
  const span = hi - lo || 1;
  return p.map(([s], i) => `${i ? "L" : "M"}${(((s - x0) / (x1 - x0)) * w).toFixed(1)},${(((hi - ls[i]) / span) * h).toFixed(1)}`).join("");
}
