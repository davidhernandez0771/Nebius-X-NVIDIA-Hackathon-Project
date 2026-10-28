// The showcase's backend calls (src/app/routers/showcase.py), each read once per page visit and kept.
import { apiUrl } from "../../api/client";
import { pmFetch } from "../../pm/api";
import { parseEpisode, type Episode } from "../../twin/replay";
import { parseFootage, parseSet, parseSets, type Footage, type SetSummary, type ShowcaseSet, type View } from "./model";

const cache = new Map<string, Promise<unknown>>();

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load();
    cache.set(key, p);
    p.catch(() => cache.delete(key)); // a failure can be retried
  }
  return p;
}

export const clearShowcaseCache = () => cache.clear();

export type Fetch = typeof fetch;

export const fetchSets = (f: Fetch = fetch): Promise<SetSummary[]> => once("sets", () => pmFetch<unknown>("/showcase/sets", undefined, f).then(parseSets));

export const fetchSet = (name: string, f: Fetch = fetch): Promise<ShowcaseSet> =>
  once(`set:${name}`, () => pmFetch<unknown>(`/showcase/sets/${encodeURIComponent(name)}`, undefined, f).then(parseSet));

const q = (v: Pick<View, "live">) => `live=${v.live ? "true" : "false"}`;

export const fetchEpisode = (name: string, v: Pick<View, "id" | "live">, f: Fetch = fetch): Promise<Episode> =>
  once(`ep:${name}:${v.live}:${v.id}`, () =>
    pmFetch<unknown>(`/showcase/sets/${encodeURIComponent(name)}/episodes/${encodeURIComponent(v.id)}?${q(v)}`, undefined, f).then(parseEpisode),
  );

export const fetchFootage = (name: string, v: Pick<View, "id" | "live">, camera: "front" | "wrist" = "front", f: Fetch = fetch): Promise<Footage> =>
  once(`ft:${name}:${v.live}:${v.id}:${camera}`, () =>
    pmFetch<unknown>(`/showcase/sets/${encodeURIComponent(name)}/footage/${encodeURIComponent(v.id)}?camera=${camera}&${q(v)}`, undefined, f)
      .then(parseFootage)
      .then((m) => ({ ...m, url: apiUrl(m.url) })),
  );

export const liveUrl = (name: string) => apiUrl(`/showcase/live/${encodeURIComponent(name)}`);
