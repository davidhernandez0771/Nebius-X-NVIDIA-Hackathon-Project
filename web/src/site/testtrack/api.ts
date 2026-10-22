// The test track's files: static JSON the site serves from web/public/test-track-data (scripts/build_test_track.py), so
// the page needs no backend. Each file is read once per visit and kept.
import { parseIndex, parseRun, type TrackIndex, type TrackRun } from "./model";

export type Fetch = typeof fetch;

const ROOT = `${import.meta.env.BASE_URL ?? "/"}test-track-data/`;
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

export const clearTrackCache = () => cache.clear();

async function json(f: Fetch, path: string): Promise<unknown> {
  const res = await f(ROOT + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export const fetchIndex = (f: Fetch = fetch): Promise<TrackIndex> => once("index", () => json(f, "index.json").then(parseIndex));

/** file: a run's path from the index (runs/<source>/<seed>.json); nothing else is fetched. */
export const fetchRun = (file: string, f: Fetch = fetch): Promise<TrackRun> => {
  if (!/^runs\/[\w-]+\/\d+\.json$/.test(file)) return Promise.reject(new Error(`not a run file: ${file}`));
  return once(`run:${file}`, () => json(f, file).then(parseRun));
};
