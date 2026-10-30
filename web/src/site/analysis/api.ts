// The failure analyst's routes (app/routers/analysis.py). An analysis is named by its id only; ids are checked here
// too, so a bad one never becomes a request.
import { apiUrl } from "../../api/client";
import type { Analysis, Sources } from "./model";

export type Fetch = typeof fetch;

const ID = /^[a-z0-9_]{1,64}$/;

async function json<T>(f: Fetch, path: string, init?: RequestInit): Promise<T> {
  const res = await f(apiUrl(path), init);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* not JSON: keep the status */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

// GETs are kept for the session, per fetch function, so /metrics and /analysis share one load of each (the server
// revalidates with an ETag anyway). A failed load is dropped so the next try asks again; a live run clears them all.
const memo = new WeakMap<Fetch, Map<string, Promise<unknown>>>();

function cachedJson<T>(f: Fetch, path: string): Promise<T> {
  let byPath = memo.get(f);
  if (!byPath) memo.set(f, (byPath = new Map()));
  const hit = byPath.get(path);
  if (hit) return hit as Promise<T>;
  const p = json<T>(f, path);
  byPath.set(path, p);
  p.catch(() => byPath.get(path) === p && byPath.delete(path));
  return p;
}

export const fetchSources = (f: Fetch = fetch) => cachedJson<Sources>(f, "/analysis/sources");

export function fetchAnalysis(id: string, f: Fetch = fetch): Promise<Analysis> {
  if (!ID.test(id)) return Promise.reject(new Error(`not an analysis id: ${id}`));
  return cachedJson<Analysis>(f, `/analysis/${id}`);
}

/** Ask Nemotron now (the server allows it only with SANT_ANALYST_LIVE=1, once a minute). */
export function runAnalysis(id: string, f: Fetch = fetch): Promise<Analysis> {
  if (!ID.test(id)) return Promise.reject(new Error(`not an analysis id: ${id}`));
  memo.delete(f); // a run changes what every GET returns (the cached run, "cached" in the sources)
  return json<Analysis>(f, `/analysis/${id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ k: 3 }),
  });
}
