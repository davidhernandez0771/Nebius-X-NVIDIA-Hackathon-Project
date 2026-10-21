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

const post = <T>(path: string, body: unknown, f: Fetch) => pmFetch<T>(path, { method: "POST", body: JSON.stringify(body) }, f);

export const startRun = (r: Recipe, f: Fetch = fetch): Promise<string> => post<{ id: string }>("/pipeline/runs", r, f).then((b) => b.id);

export const estimateRun = (r: Recipe, f: Fetch = fetch): Promise<{ demos: number; remaining_s: number | null }> =>
  post<{ demos?: number; remaining_s?: number | null }>("/pipeline/estimate", r, f).then((b) => ({ demos: b.demos ?? 0, remaining_s: b.remaining_s ?? null }));

/** Cancel or resume a run; both answer with its snapshot (resume: 409 unless it stopped). */
export const cancelRun = (id: string, f: Fetch = fetch): Promise<RunState> => post<unknown>(`/pipeline/runs/${encodeURIComponent(id)}/cancel`, {}, f).then(parseRun);
export const resumeRun = (id: string, f: Fetch = fetch): Promise<RunState> => post<unknown>(`/pipeline/runs/${encodeURIComponent(id)}/resume`, {}, f).then(parseRun);

export type Preset = { id: NonNullable<Recipe["preset"]>; label: string; steps: number | null; eval_n: number | null };
export type PipelineConfig = { enabled: boolean; presets: Preset[] };

/** The server's pipeline settings (GET /pipeline/config): whether it runs at all, and its presets. */
export const fetchConfig = (f: Fetch = fetch): Promise<PipelineConfig> =>
  pmFetch<{ enabled?: unknown; presets?: Record<string, { label?: unknown; steps?: unknown; eval_n?: unknown }> }>("/pipeline/config", undefined, f).then((b) => ({
    enabled: b.enabled === true,
    presets: Object.entries(b.presets ?? {})
      .filter(([id]) => id === "smoke" || id === "standard" || id === "long")
      .map(([id, p]) => ({
        id: id as Preset["id"],
        label: typeof p?.label === "string" ? p.label : id,
        steps: typeof p?.steps === "number" ? p.steps : null,
        eval_n: typeof p?.eval_n === "number" ? p.eval_n : null,
      })),
  }));

/** A finished run's downloads (GET /pipeline/runs/{id}/artifacts). */
export const fetchArtifacts = (id: string, f: Fetch = fetch): Promise<RunState["artifacts"]> =>
  pmFetch<unknown>(`/pipeline/runs/${encodeURIComponent(id)}/artifacts`, undefined, f).then((b) => parseRun({ artifacts: (b as { artifacts?: unknown })?.artifacts }).artifacts);

export const fetchRunFootage = (id: string, episode: string, f: Fetch = fetch): Promise<Footage> =>
  pmFetch<unknown>(`/pipeline/runs/${encodeURIComponent(id)}/footage/${encodeURIComponent(episode)}?camera=front`, undefined, f)
    .then(parseFootage)
    .then((m) => ({ ...m, url: apiUrl(m.url) }));

/** An artifact's download link (its url from the API, made absolute). */
export const downloadUrl = (url: string) => (url ? apiUrl(url) : "");
