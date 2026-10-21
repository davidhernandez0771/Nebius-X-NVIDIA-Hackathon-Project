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

export const cancelRun = (id: string, f: Fetch = fetch) => post<unknown>(`/pipeline/runs/${encodeURIComponent(id)}/cancel`, {}, f);
export const resumeRun = (id: string, f: Fetch = fetch) => post<unknown>(`/pipeline/runs/${encodeURIComponent(id)}/resume`, {}, f);

export const fetchRunFootage = (id: string, episode: string, f: Fetch = fetch): Promise<Footage> =>
  pmFetch<unknown>(`/pipeline/runs/${encodeURIComponent(id)}/footage/${encodeURIComponent(episode)}?camera=front`, undefined, f)
    .then(parseFootage)
    .then((m) => ({ ...m, url: apiUrl(m.url) }));

/** An artifact's download link (its url from the API, made absolute). */
export const downloadUrl = (url: string) => (url ? apiUrl(url) : "");
