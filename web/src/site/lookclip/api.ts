// The LOOK clip's files: static JSON the site serves from web/public/look-clip (scripts/build_look_clip.py), so it
// needs no backend. Each file is read once per visit and kept.
import { parseRun, type TrackRun } from "../testtrack/model";
import { parseClip, type Clip } from "./model";

export type Fetch = typeof fetch;

const ROOT = `${import.meta.env.BASE_URL ?? "/"}look-clip/`;
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

export const clearClipCache = () => cache.clear();

async function json(f: Fetch, path: string): Promise<unknown> {
  const res = await f(ROOT + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export const fetchClip = (f: Fetch = fetch): Promise<Clip> => once("index", () => json(f, "index.json").then(parseClip));

/** file: a run's path from the index (runs/raw|v2/<seed>.json); nothing else is fetched. */
export const fetchClipRun = (file: string, f: Fetch = fetch): Promise<TrackRun> => {
  if (!/^runs\/(raw|v2)\/\d+\.json$/.test(file)) return Promise.reject(new Error(`not a clip run: ${file}`));
  return once(`run:${file}`, () => json(f, file).then(parseRun));
};
