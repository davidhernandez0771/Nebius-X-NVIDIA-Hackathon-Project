// SANT working live: the events of a running experiment (GET /showcase/live/{name}, server-sent events from
// src/app/routers/showcase.py) folded into what the page shows: the pipeline's stages lighting up in order, each
// demo's verdicts as they arrive, and every new variant with its badge. Pure (applyEvent); the hook is useLiveFeed.

export const STAGES = [
  { id: "physics", label: "Physics check" },
  { id: "repair", label: "Repair" },
  { id: "multiply", label: "Multiply" },
  { id: "train", label: "Train" },
  { id: "eval", label: "Evaluate" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];
export type StageStatus = "waiting" | "running" | "done";

export type DemoProgress = {
  physics?: { success: boolean; reasons: string[] };
  repair?: { status: string; repairs: number };
  multiply?: { k: number; n: number };
};

export type FeedVariant = { id: string; source: string; seed: number | null; success: boolean; reasons: string[]; frames: number };

export type FeedState = {
  name: string | null;
  input: string | null;
  ids: string[];
  stages: Record<StageId, StageStatus>;
  demos: Record<string, DemoProgress>;
  variants: FeedVariant[];
  train: { cell: string; loss: number }[];
  evals: { cell: string; k: number; n: number }[];
  lastAt: string | null;
  ended: boolean;
};

export type FeedEvent = { type: string; at?: string; [k: string]: unknown };

export function initialFeed(): FeedState {
  return {
    name: null,
    input: null,
    ids: [],
    stages: { physics: "waiting", repair: "waiting", multiply: "waiting", train: "waiting", eval: "waiting" },
    demos: {},
    variants: [],
    train: [],
    evals: [],
    lastAt: null,
    ended: false,
  };
}

export function parseEvent(data: string): FeedEvent | null {
  try {
    const e = JSON.parse(data) as unknown;
    return e && typeof e === "object" && typeof (e as FeedEvent).type === "string" ? (e as FeedEvent) : null;
  } catch {
    return null;
  }
}

const ORDER: StageId[] = STAGES.map((s) => s.id);

/** Set a stage; the pipeline runs in order, so every stage before one that has started is done. */
function mark(s: FeedState, id: StageId, status: StageStatus): FeedState["stages"] {
  const stages = { ...s.stages };
  const k = ORDER.indexOf(id);
  ORDER.slice(0, k).forEach((p) => (stages[p] = "done"));
  if (stages[id] !== "done" || status === "done") stages[id] = status;
  return stages;
}

const everyDemo = (s: FeedState, demos: FeedState["demos"], key: keyof DemoProgress) => s.ids.length > 0 && s.ids.every((i) => demos[i]?.[key] !== undefined);

export function applyEvent(s: FeedState, e: FeedEvent): FeedState {
  const at = typeof e.at === "string" ? e.at : s.lastAt;
  const demo = (id: unknown, patch: DemoProgress) => {
    const key = String(id);
    return { ...s.demos, [key]: { ...s.demos[key], ...patch } };
  };
  switch (e.type) {
    case "hello": {
      const ids = Array.isArray(e.ids) ? e.ids.map(String) : [];
      return { ...initialFeed(), name: String(e.name ?? ""), input: typeof e.input === "string" ? e.input : null, ids, demos: Object.fromEntries(ids.map((i) => [i, {}])) };
    }
    case "physics": {
      const demos = demo(e.id, { physics: { success: e.success === true, reasons: Array.isArray(e.reasons) ? e.reasons.map(String) : [] } });
      const next = { ...s, demos, lastAt: at };
      return { ...next, stages: mark(s, "physics", everyDemo(s, demos, "physics") ? "done" : "running") };
    }
    case "repair": {
      const demos = demo(e.id, { repair: { status: String(e.status), repairs: Number(e.repairs ?? 0) } });
      return { ...s, demos, lastAt: at, stages: mark(s, "repair", everyDemo(s, demos, "repair") ? "done" : "running") };
    }
    case "align":
      return { ...s, lastAt: at, stages: mark(s, "multiply", "running") };
    case "variant": {
      if (s.variants.some((v) => v.id === e.id)) return s;
      const v: FeedVariant = {
        id: String(e.id),
        source: String(e.source ?? ""),
        seed: typeof e.seed === "number" ? e.seed : null,
        success: e.success === true,
        reasons: Array.isArray(e.reasons) ? e.reasons.map(String) : [],
        frames: Number(e.frames ?? 0),
      };
      return { ...s, variants: [v, ...s.variants], stages: mark(s, "multiply", "running") };
    }
    case "multiply":
      return { ...s, demos: demo(e.id, { multiply: { k: Number(e.k), n: Number(e.n) } }), lastAt: at, stages: mark(s, "multiply", "running") };
    case "stage": {
      const text = String(e.text ?? "");
      if (e.stage === "grid") return { ...s, lastAt: at, stages: mark(s, "multiply", "done") };
      if (e.stage === "train" || e.stage === "eval") {
        const done = text.startsWith("done earlier");
        return { ...s, lastAt: at, stages: mark(s, e.stage, done ? "done" : "running") };
      }
      return { ...s, lastAt: at };
    }
    case "train":
      return { ...s, lastAt: at, train: Array.isArray(e.cells) ? (e.cells as FeedState["train"]) : [], stages: mark(s, "train", "done") };
    case "eval":
      return { ...s, lastAt: at, evals: Array.isArray(e.cells) ? (e.cells as FeedState["evals"]) : [], stages: mark(s, "eval", "done") };
    case "done":
      return e.through === "results" ? { ...s, lastAt: at, stages: mark(s, "eval", "done") } : { ...s, lastAt: at };
    case "end":
      return { ...s, ended: true };
    default:
      return s;
  }
}
