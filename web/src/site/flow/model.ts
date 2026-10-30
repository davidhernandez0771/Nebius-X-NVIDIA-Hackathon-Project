// The whole pipeline (/flow): the shape GET /flow returns (app/routers/flow.py), its checks, and the static fallback
// the page shows when the backend can't be reached. The fallback's numbers come from the Results page's own data
// (proofData.ts, results.json), which cite the same notes the endpoint cites; nothing here measures anything.
import { CLIMB, TEACHER } from "../results/proofData";
import results from "../results/results.json";

export type Rate = { k: number; n: number; ci: [number, number] | null };

export type Metric = {
  headline: string;
  detail?: string;
  value?: number;
  before?: Rate;
  after?: Rate;
  p?: number | null;
  runs?: number;
};

export type StageId = "record" | "measure" | "repair" | "verify" | "multiply" | "teach" | "train" | "evaluate" | "analyse" | "recipe";

export type Stage = {
  id: StageId;
  title: string;
  does: string;
  link: string;
  metric: Metric;
  source: { kind: "note" | "file" | "cache" | "loop"; label: string; note: string | null };
};

export type LoopStageId = "diagnose" | "freeze" | "train_recipe" | "train_control" | "eval_recipe" | "eval_control" | "compare";
export type LoopStageStatus = "pending" | "running" | "done" | "provided" | "failed";
export type LoopStatus = "none" | "pending" | "running" | "paused" | "done" | "failed";

export type LoopArm = { successes: number; n: number; ci: [number, number] | null };
export type LoopResult = {
  recipe: LoopArm;
  control: LoopArm;
  p_one_sided: number | null;
  p_two_sided: number | null;
  decision: "recipe_better" | "no_difference_shown" | null;
  sample: boolean;
};

export type Loop =
  | { status: "none" }
  | {
      status: Exclude<LoopStatus, "none">;
      name: string;
      current: LoopStageId | null;
      stages: { id: LoopStageId; status: LoopStageStatus; started: string | null; ended: string | null }[];
      seeds: [number, number] | null;
      result: LoopResult | null;
    };

export type Flow = { as_of: string; stages: Stage[]; loop_back: { from: StageId; to: StageId }; loop: Loop };

export const STAGE_IDS: StageId[] = ["record", "measure", "repair", "verify", "multiply", "teach", "train", "evaluate", "analyse", "recipe"];
/** The stages the loop goes round: the recipe picks the next scenes to multiply into. */
export const CYCLE_FROM: StageId = "multiply";

export const LOOP_STAGES: { id: LoopStageId; label: string; doing: string }[] = [
  { id: "diagnose", label: "Diagnose", doing: "Nemotron is reading the failures" },
  { id: "freeze", label: "Freeze", doing: "freezing the recipe and the pre-registration" },
  { id: "train_recipe", label: "Train recipe", doing: "training the recipe arm" },
  { id: "train_control", label: "Train control", doing: "training the uniform control arm" },
  { id: "eval_recipe", label: "Eval recipe", doing: "evaluating the recipe arm" },
  { id: "eval_control", label: "Eval control", doing: "evaluating the control arm" },
  { id: "compare", label: "Compare", doing: "comparing the two arms" },
];

const LOOP_STATUSES: LoopStatus[] = ["none", "pending", "running", "paused", "done", "failed"];
const STAGE_STATUSES: LoopStageStatus[] = ["pending", "running", "done", "provided", "failed"];

// ------------------------------------------------------------------ the fallback

type RawArm = { key: string; k: number | null; n: number; ci?: [number, number] };
const multiplyArms = (results.experiments.find((e) => e.id === "multiply")?.groups ?? []).flatMap((g) => g.arms as RawArm[]);
function arm(key: string): Rate {
  const a = multiplyArms.find((x) => x.key === key)!;
  return { k: a.k ?? 0, n: a.n, ci: a.ci ?? null };
}

const climb = (key: "v1" | "v2"): Rate => {
  const c = CLIMB.find((s) => s.key === key)!;
  return { k: c.k, n: c.n, ci: c.ci };
};

const NOTES = "docs/superpowers/notes/";
const v1 = climb("v1");
const v2 = climb("v2");
const before = arm("raw_10_30k");
const after = arm("raw_multiply_10_30k");

export const FALLBACK: Flow = {
  as_of: "2026-10-28",
  loop_back: { from: "recipe", to: "multiply" },
  loop: { status: "none" },
  stages: [
    {
      id: "record",
      title: "Record",
      does: "A person drives the simulated arm with a mouse or webcam and SANT saves each take as a demo.",
      link: "/record",
      metric: { headline: "10 human mouse demos", detail: "One person; the whole climb starts from them", value: 10 },
      source: { kind: "note", label: "Distill pre-registration note", note: NOTES + "2026-10-21-distill-prereg.md" },
    },
    {
      id: "measure",
      title: "Measure",
      does: "Every demo is replayed in Isaac physics and measured: contacts, forces, where the cube ended.",
      link: "/pm/review",
      metric: { headline: "0/10 webcam demos pass as recorded", detail: "Up to 927 N pressing into the bin (5 N limit)", before: { k: 0, n: 10, ci: null } },
      source: { kind: "note", label: "Site results note (real webcam demos)", note: NOTES + "2026-10-20-site-results-live.md" },
    },
    {
      id: "repair",
      title: "Repair",
      does: "Rules fix what the measurements flag: trim, smooth, recenter the grasp, release above the bin.",
      link: "/pm/review",
      metric: { headline: "3/10 repaired → 24/30 copies verified", detail: "Rules repair on the webcam demos", after: { k: 3, n: 10, ci: null } },
      source: { kind: "note", label: "PR live-12 note", note: NOTES + "2026-10-20-pr-live-12.md" },
    },
    {
      id: "verify",
      title: "Verify",
      does: "A demo only counts if its physics replay puts the cube in the bin with no hard contact.",
      link: "/data",
      metric: { headline: "10/10 mouse demos pass on replay", detail: "And 100/100 multiplied copies verified", after: { k: 10, n: 10, ci: null } },
      source: { kind: "note", label: "Mouse demos results note", note: NOTES + "2026-10-20-mouse20261020-results.md" },
    },
    {
      id: "multiply",
      title: "Multiply",
      does: "Each verified demo is moved into new scenes and replayed; only copies that pass are kept.",
      link: "/site/results",
      metric: {
        headline: `${before.k}/${before.n} → ${after.k}/${after.n}`,
        detail: "10 scripted demos alone vs + 100 verified copies; Fisher p = 0.00055",
        before,
        after,
        p: 0.00055,
      },
      source: { kind: "file", label: "Results page data, from the T3 status note", note: NOTES + "2026-10-15-t3-status.md" },
    },
    {
      id: "teach",
      title: "Teach (RL)",
      does: "An RL teacher learns the task from the human demo starts, then has to pass SANT's own physics check.",
      link: "/site/results",
      metric: {
        headline: `${TEACHER.final.withDemos.k}/${TEACHER.final.withDemos.n} with demos vs ${TEACHER.final.withoutDemos.k}/${TEACHER.final.withoutDemos.n} without`,
        detail: "Same code, budget and seed",
        before: TEACHER.final.withoutDemos,
        after: TEACHER.final.withDemos,
      },
      source: { kind: "note", label: "Distill pre-registration note, Amendment 6", note: NOTES + "2026-10-21-distill-prereg.md" },
    },
    {
      id: "train",
      title: "Train (ACT)",
      does: "The teacher's verified runs train a camera policy (ACT) that sees only its cameras and joints.",
      link: "/metrics",
      metric: { headline: `v1 ${v1.k}/${v1.n} → v2 ${v2.k}/${v2.n}`, detail: "v2: 180k steps + a gripper deadband; Wilson 95% CI 0.598–0.858", before: v1, after: v2 },
      source: { kind: "note", label: "Distill and big-test pre-registration notes", note: NOTES + "2026-10-23-bigtest-prereg.md" },
    },
    {
      id: "evaluate",
      title: "Evaluate",
      does: "The policy runs once on 40 scenes it has never seen, and SANT judges every run.",
      link: "/test-track",
      metric: { headline: `${v2.k}/${v2.n} on fresh seeds 5400–5439`, detail: "40 recorded runs, 75% success", after: v2, runs: 40 },
      source: { kind: "note", label: "Big-test pre-registration note", note: NOTES + "2026-10-23-bigtest-prereg.md" },
    },
    {
      id: "analyse",
      title: "Analyse (Nemotron)",
      does: "Nemotron reads how the policy failed and proposes the next data; code checks every claim.",
      link: "/analysis",
      metric: { headline: "18 failures read: 17 drops", detail: "3 samples, agreement 0.83, region p = 0.092, $0.042" },
      source: { kind: "note", label: "Failure-analyst note, section 1b", note: NOTES + "2026-10-25-failure-analyst.md" },
    },
    {
      id: "recipe",
      title: "Recipe",
      does: "The checked recipe says which scenes to multiply into next; a recipe arm is tested against a uniform control.",
      link: "/pipeline",
      metric: { headline: "1 scene region proposed", detail: "Cube left, bin right: a weak lead, not a finding. Recipe vs uniform A/B not run yet.", value: 1 },
      source: { kind: "note", label: "Failure-analyst note, section 1b (verdict)", note: NOTES + "2026-10-25-failure-analyst.md" },
    },
  ],
};

// ------------------------------------------------------------------ parsing

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);

function rate(x: unknown): Rate | undefined {
  if (!isObj(x)) return undefined;
  const k = num(x.k);
  const n = num(x.n);
  if (k === undefined || n === undefined || n <= 0) return undefined;
  const ci = Array.isArray(x.ci) && x.ci.length === 2 && x.ci.every((c) => num(c) !== undefined) ? (x.ci as [number, number]) : null;
  return { k, n, ci };
}

/** A site path only ("/analysis"); anything else (a scheme, //host) becomes this page. */
function sitePath(x: unknown): string {
  const s = str(x);
  return s && /^\/(?!\/)[\w\-/]*$/.test(s) ? s : "/flow";
}

function parseLoop(x: unknown): Loop {
  if (!isObj(x) || !LOOP_STATUSES.includes(x.status as LoopStatus) || x.status === "none") return { status: "none" };
  const stages = (Array.isArray(x.stages) ? x.stages : []).filter(isObj).flatMap((s) => {
    const id = LOOP_STAGES.find((l) => l.id === s.id)?.id;
    if (!id) return [];
    const status = STAGE_STATUSES.includes(s.status as LoopStageStatus) ? (s.status as LoopStageStatus) : "pending";
    return [{ id, status, started: str(s.started) ?? null, ended: str(s.ended) ?? null }];
  });
  const seeds = Array.isArray(x.seeds) && x.seeds.length === 2 && x.seeds.every((s) => num(s) !== undefined) ? (x.seeds as [number, number]) : null;
  let result: LoopResult | null = null;
  if (isObj(x.result)) {
    const r = x.result;
    const a = (v: unknown): LoopArm | null => {
      if (!isObj(v) || num(v.successes) === undefined || num(v.n) === undefined) return null;
      const ci = Array.isArray(v.ci) && v.ci.length === 2 ? (v.ci as [number, number]) : null;
      return { successes: v.successes as number, n: v.n as number, ci };
    };
    const rec = a(r.recipe);
    const ctl = a(r.control);
    if (rec && ctl)
      result = {
        recipe: rec,
        control: ctl,
        p_one_sided: num(r.p_one_sided) ?? null,
        p_two_sided: num(r.p_two_sided) ?? null,
        decision: r.decision === "recipe_better" || r.decision === "no_difference_shown" ? r.decision : null,
        sample: r.sample === true,
      };
  }
  return {
    status: x.status as Exclude<LoopStatus, "none">,
    name: str(x.name) ?? "loop",
    current: LOOP_STAGES.find((l) => l.id === x.current)?.id ?? null,
    stages,
    seeds,
    result,
  };
}

/** GET /flow's body, checked: every stage present, in order. Throws on anything else (the page falls back). */
export function parseFlow(body: unknown): Flow {
  if (!isObj(body) || !Array.isArray(body.stages)) throw new Error("not a flow summary");
  const byId = new Map(body.stages.filter(isObj).map((s) => [s.id, s]));
  const stages: Stage[] = STAGE_IDS.map((id) => {
    const s = byId.get(id);
    if (!s || !isObj(s.metric) || !str(s.metric.headline)) throw new Error(`the flow summary has no ${id} stage`);
    const m = s.metric;
    const src = isObj(s.source) ? s.source : {};
    const kind = ["note", "file", "cache", "loop"].includes(src.kind as string) ? (src.kind as Stage["source"]["kind"]) : "note";
    const fb = FALLBACK.stages.find((f) => f.id === id)!;
    return {
      id,
      title: str(s.title) ?? fb.title,
      does: str(s.does) ?? fb.does,
      link: sitePath(s.link),
      metric: {
        headline: m.headline as string,
        detail: str(m.detail),
        value: num(m.value),
        before: rate(m.before),
        after: rate(m.after),
        p: num(m.p) ?? null,
        runs: num(m.runs),
      },
      source: { kind, label: str(src.label) ?? fb.source.label, note: str(src.note) ?? null },
    };
  });
  return { as_of: str(body.as_of) ?? FALLBACK.as_of, stages, loop_back: FALLBACK.loop_back, loop: parseLoop(body.loop) };
}

// ------------------------------------------------------------------ text

export const rateText = (r: Rate) => `${r.k}/${r.n}`;

/** One line on where the closed loop is. */
export function loopLine(loop: Loop): string {
  if (loop.status === "none") return "The closed loop has not run yet: its command is ready for the GPU machine.";
  const doing = LOOP_STAGES.find((l) => l.id === loop.current)?.doing;
  switch (loop.status) {
    case "running":
      return `Loop ${loop.name} is running: ${doing ?? "working"}.`;
    case "failed":
      return `Loop ${loop.name} stopped at ${loop.current ?? "a stage"}; re-running resumes it.`;
    case "paused":
      return `Loop ${loop.name} is paused before ${doing ?? "its next stage"}.`;
    case "pending":
      return `Loop ${loop.name} is set up and waiting to start.`;
    case "done": {
      const r = loop.result;
      if (!r) return `Loop ${loop.name} finished.`;
      const verdict = r.decision === "recipe_better" ? "the recipe arm is better" : "no difference shown";
      return `Loop ${loop.name} finished: recipe ${r.recipe.successes}/${r.recipe.n} vs uniform ${r.control.successes}/${r.control.n}, ${verdict}${r.sample ? " (smoke test, not a result)" : ""}.`;
    }
  }
}
