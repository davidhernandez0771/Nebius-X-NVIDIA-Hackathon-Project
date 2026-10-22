// The pipeline's backend calls (pm/pipeline-api, src/app/routers/pipeline.py): the runs, one run's snapshot and live
// events, starting, cancelling and resuming a run, the pre-run estimate, and a run's footage (the /showcase body).
import { apiUrl } from "../../api/client";
import { pmFetch } from "../../pm/api";
import { parseFootage, type Footage } from "../data/model";
import { parseRun, parseRuns, type RunState, type RunSummary } from "./model";

export type Fetch = typeof fetch;

export const fetchRuns = (f: Fetch = fetch): Promise<RunSummary[]> => pmFetch<unknown>("/pipeline/runs", undefined, f).then(parseRuns);

export const fetchRun = (id: string, f: Fetch = fetch): Promise<RunState> => pmFetch<unknown>(`/pipeline/runs/${encodeURIComponent(id)}`, undefined, f).then(parseRun);

export const eventsUrl = (id: string) => apiUrl(`/pipeline/runs/${encodeURIComponent(id)}/events`);

/** What a run is asked to do (POST /pipeline/runs and /pipeline/estimate). */
export type Recipe = {
  demos?: string[];
  tag?: string;
  input?: "mouse" | "keyboard" | "camera";
  name?: string;
  preset?: "smoke" | "standard" | "long";
  variants?: number;
  repairer?: "rules" | "nemotron-edits" | "hybrid";
  stop_after?: "grid" | "train" | "eval" | "results";
  dry_run?: boolean;
};

/** The teacher recipe (T3's RL teacher → the gate → T6's distillation). The server forbids any other field. */
export type TeacherRecipe = {
  kind: "teacher";
  human_run: string;
  teacher_n: 300 | 600;
  dagger: boolean;
  preset: "smoke" | "full";
  rl_iterations?: number;
  dry_run?: boolean;
  name?: string;
};
export type AnyRecipe = Recipe | TeacherRecipe;

const post = <T>(path: string, body: unknown, f: Fetch) => pmFetch<T>(path, { method: "POST", body: JSON.stringify(body) }, f);

export const startRun = (r: AnyRecipe, f: Fetch = fetch): Promise<string> => post<{ id: string }>("/pipeline/runs", r, f).then((b) => b.id);

export const estimateRun = (r: AnyRecipe, f: Fetch = fetch): Promise<{ demos: number; remaining_s: number | null }> =>
  post<{ demos?: number; remaining_s?: number | null }>("/pipeline/estimate", r, f).then((b) => ({ demos: b.demos ?? 0, remaining_s: b.remaining_s ?? null }));

/** Cancel or resume a run; both answer with its snapshot (resume: 409 unless it stopped). */
export const cancelRun = (id: string, f: Fetch = fetch): Promise<RunState> => post<unknown>(`/pipeline/runs/${encodeURIComponent(id)}/cancel`, {}, f).then(parseRun);
export const resumeRun = (id: string, f: Fetch = fetch): Promise<RunState> => post<unknown>(`/pipeline/runs/${encodeURIComponent(id)}/resume`, {}, f).then(parseRun);

export type Preset = { id: NonNullable<Recipe["preset"]>; label: string; steps: number | null; eval_n: number | null };
export type TeacherPreset = { id: TeacherRecipe["preset"]; label: string; rl_iterations: number | null };
export type PipelineConfig = {
  enabled: boolean;
  presets: Preset[];
  /** The teacher recipe's presets and rollout counts, when the server has it. */
  teacher: { presets: TeacherPreset[]; teacher_n: TeacherRecipe["teacher_n"][] } | null;
};

/** The server's pipeline settings (GET /pipeline/config): whether it runs at all, and its presets. */
export const fetchConfig = (f: Fetch = fetch): Promise<PipelineConfig> =>
  pmFetch<{
    enabled?: unknown;
    presets?: Record<string, { label?: unknown; steps?: unknown; eval_n?: unknown }>;
    recipes?: { teacher?: { presets?: Record<string, { label?: unknown; rl_iterations?: unknown }>; teacher_n?: unknown } };
  }>("/pipeline/config", undefined, f).then((b) => ({
    enabled: b.enabled === true,
    teacher: b.recipes?.teacher
      ? {
          presets: Object.entries(b.recipes.teacher.presets ?? {})
            .filter(([id]) => id === "smoke" || id === "full")
            .map(([id, p]) => ({ id: id as TeacherPreset["id"], label: typeof p?.label === "string" ? p.label : id, rl_iterations: typeof p?.rl_iterations === "number" ? p.rl_iterations : null })),
          teacher_n: (Array.isArray(b.recipes.teacher.teacher_n) ? b.recipes.teacher.teacher_n : [300, 600]).filter((n): n is 300 | 600 => n === 300 || n === 600),
        }
      : null,
    presets: Object.entries(b.presets ?? {})
      .filter(([id]) => id === "smoke" || id === "standard" || id === "long")
      .map(([id, p]) => ({
        id: id as Preset["id"],
        label: typeof p?.label === "string" ? p.label : id,
        steps: typeof p?.steps === "number" ? p.steps : null,
        eval_n: typeof p?.eval_n === "number" ? p.eval_n : null,
      })),
  }));

export type HumanRun = { name: string; cell: string; start_state: string };

/** The trained human-demo runs a teacher can learn from (GET /pipeline/human-runs). */
export const fetchHumanRuns = (f: Fetch = fetch): Promise<HumanRun[]> =>
  pmFetch<{ runs?: unknown }>("/pipeline/human-runs", undefined, f).then((b) =>
    (Array.isArray(b.runs) ? b.runs : [])
      .map((r) => r as Partial<HumanRun>)
      .filter((r): r is HumanRun => typeof r.name === "string")
      .map((r) => ({ name: r.name, cell: String(r.cell ?? ""), start_state: String(r.start_state ?? "") })),
  );

/** A finished run's downloads (GET /pipeline/runs/{id}/artifacts). */
export const fetchArtifacts = (id: string, f: Fetch = fetch): Promise<RunState["artifacts"]> =>
  pmFetch<unknown>(`/pipeline/runs/${encodeURIComponent(id)}/artifacts`, undefined, f).then((b) => parseRun({ artifacts: (b as { artifacts?: unknown })?.artifacts }).artifacts);

export const fetchRunFootage = (id: string, episode: string, f: Fetch = fetch): Promise<Footage> =>
  pmFetch<unknown>(`/pipeline/runs/${encodeURIComponent(id)}/footage/${encodeURIComponent(episode)}?camera=front`, undefined, f)
    .then(parseFootage)
    .then((m) => ({ ...m, url: apiUrl(m.url) }));

/** An artifact's download link (its url from the API, made absolute). */
export const downloadUrl = (url: string) => (url ? apiUrl(url) : "");
