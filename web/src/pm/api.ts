// Backend calls for SANT's robot-demo pages ("Perfect, then multiply"). Unlike ../api/client.ts,
// errors keep their HTTP status and a `kind`, so each page can say exactly
// what went wrong: the backend is down, the sim worker is down (503), or the
// route isn't on this backend yet (FastAPI's bare 404 "Not Found", or 405).

import { apiUrl } from "../api/client";
import type { Demo, DemoReview, StoredDiagnosis } from "./types";

export type ErrorKind =
  | "unreachable"
  | "sim_down"
  | "route_missing"
  | "not_found"
  | "conflict"
  | "invalid"
  | "server";

export class PmApiError extends Error {
  constructor(
    readonly status: number,
    readonly kind: ErrorKind,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "PmApiError";
  }
}

const BASE = apiUrl("");

function classify(status: number, detail: string): ErrorKind {
  if (status === 503) return "sim_down";
  if (status === 405 || (status === 404 && detail === "Not Found")) return "route_missing";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "invalid";
  return "server";
}

function readDetail(body: string): string {
  try {
    const detail = (JSON.parse(body) as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (detail !== undefined) return JSON.stringify(detail);
  } catch {
    /* not JSON */
  }
  return body;
}

export async function pmFetch<T>(
  path: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
  base: string = BASE,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  } catch (e) {
    throw new PmApiError(0, "unreachable", e instanceof Error ? e.message : String(e));
  }
  const body = await res.text();
  if (!res.ok) {
    const detail = readDetail(body);
    throw new PmApiError(res.status, classify(res.status, detail), detail);
  }
  return JSON.parse(body) as T;
}

/** WebSocket URL of the teleop relay (src/app/routers/teleop.py), from the API base URL. */
export function teleopSocketUrl(base: string = BASE): string {
  return `${base.replace(/\/$/, "").replace(/^http/, "ws")}/ws/teleop?role=browser`;
}

/** One line a person can act on, for any error a page shows. */
export function describeError(err: unknown): string {
  if (!(err instanceof PmApiError)) return err instanceof Error ? err.message : String(err);
  switch (err.kind) {
    case "unreachable":
      return `Can't reach the backend at ${BASE || "this origin"}. Start it, then reload.`;
    case "sim_down":
      return `The sim worker isn't running. Start it, then try again. (${err.detail})`;
    case "route_missing":
      return "This backend doesn't have that route yet.";
    default:
      return err.detail;
  }
}

const post = { method: "POST" } as const;

export const pmApi = {
  listDemos: () => pmFetch<Demo[]>("/demos"),
  getDemo: (id: string) => pmFetch<Demo>(`/demos/${encodeURIComponent(id)}`),
  /** The saved diagnosis, or null if the demo has none yet. */
  getDiagnosis: async (id: string): Promise<StoredDiagnosis | null> => {
    try {
      return await pmFetch<StoredDiagnosis>(`/demos/${encodeURIComponent(id)}/diagnosis`);
    } catch (e) {
      if (e instanceof PmApiError && e.kind === "not_found") return null;
      throw e;
    }
  },
  /** Physics, the stored Nemotron verdict and the fixes applied; null on a backend without the route. */
  getReview: async (id: string): Promise<DemoReview | null> => {
    try {
      return await pmFetch<DemoReview>(`/demos/${encodeURIComponent(id)}/review`);
    } catch (e) {
      if (e instanceof PmApiError && e.kind === "not_found") return null;
      throw e;
    }
  },
  perfect: (id: string, diagnoser: "rules" | "nemotron") =>
    pmFetch<unknown>(`/demos/${encodeURIComponent(id)}/perfect?diagnoser=${diagnoser}`, post),
  /** Throw a demo away: the backend moves its folder to demos/_discarded (never deletes it). */
  discardDemo: (id: string) =>
    pmFetch<{ id: string; discarded_to: string }>(`/demos/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getJob: (id: string) => pmFetch<unknown>(`/jobs/${encodeURIComponent(id)}`),
  exportDataset: () => pmFetch<unknown>("/export", post),
};
