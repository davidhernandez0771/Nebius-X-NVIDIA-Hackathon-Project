// The heavier stations' files, streamed in the background while the visitor is on the hero: in the order
// the journey reaches them (waiting.ts prefetchOrder), a few at a time, each file once. Bytes are
// counted as they arrive against the files' known sizes (assetSizes.json), so the in-place "loading"
// state (ui/Wait.tsx) shows real progress. A finished file goes into three's cache, where the scenes' own
// loaders (drei's useGLTF, GLTFLoader) find it without a second download; the loaders that take a fetch
// (the crack, the robot models) get it through `fetch`. A file that fails counts as done: its scene falls
// back as it always has.
import * as THREE from "three";
import SIZES from "./assetSizes.json";

export interface AssetProgress {
  /** Bytes arrived. */
  loaded: number;
  /** Bytes in all (the files' sizes). */
  total: number;
  /** Every file arrived or failed. */
  done: boolean;
  /** How many failed. */
  failed: number;
}

export interface Assets {
  /** Queue files, after what is queued already (each file is fetched once). */
  want(urls: readonly string[]): void;
  /** Move files to the front of the queue (the visitor is going there now). */
  prioritize(urls: readonly string[]): void;
  /** A file's bytes (queued at the front if it wasn't). */
  bytes(url: string): Promise<ArrayBuffer>;
  /** The same as a fetch Response, for loaders that take a fetch. */
  fetch(url: string): Promise<Response>;
  progress(urls: readonly string[]): AssetProgress;
  subscribe(fn: () => void): () => void;
}

interface Entry {
  url: string;
  size: number;
  loaded: number;
  state: "queued" | "loading" | "done" | "failed";
  promise: Promise<ArrayBuffer>;
  resolve(b: ArrayBuffer): void;
  reject(e: unknown): void;
}

export function createAssets({
  sizes,
  fetchImpl,
  base,
  concurrency = 2,
  cache,
}: {
  sizes: Record<string, number>;
  fetchImpl: (url: string) => Promise<Response>;
  base: string;
  concurrency?: number;
  cache?: (url: string, buf: ArrayBuffer) => void;
}): Assets {
  const entries = new Map<string, Entry>();
  const queue: Entry[] = [];
  const fns = new Set<() => void>();
  let active = 0;
  const notify = () => fns.forEach((fn) => fn());
  const sizeOf = (url: string) => sizes[url.startsWith(base) ? url.slice(base.length) : url] ?? 0;

  const entry = (url: string): Entry => {
    const had = entries.get(url);
    if (had) return had;
    let resolve!: (b: ArrayBuffer) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<ArrayBuffer>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Nobody may ask for a failed file's bytes; that's not an unhandled error.
    promise.catch(() => {});
    const e: Entry = { url, size: sizeOf(url), loaded: 0, state: "queued", promise, resolve, reject };
    entries.set(url, e);
    queue.push(e);
    return e;
  };

  const start = async (e: Entry) => {
    e.state = "loading";
    active++;
    try {
      const res = await fetchImpl(e.url);
      if (!res.ok) throw new Error(`world: ${e.url}: HTTP ${res.status}`);
      let buf: ArrayBuffer;
      if (res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          e.loaded += value.byteLength;
          notify();
        }
        const all = new Uint8Array(e.loaded);
        let at = 0;
        for (const c of chunks) {
          all.set(c, at);
          at += c.byteLength;
        }
        buf = all.buffer;
      } else {
        buf = await res.arrayBuffer();
        e.loaded = buf.byteLength;
      }
      if (!e.size) e.size = buf.byteLength;
      cache?.(e.url, buf);
      e.state = "done";
      e.resolve(buf);
    } catch (err) {
      console.warn(`world: ${e.url} didn't load in the background`, err);
      e.state = "failed";
      e.reject(err);
    } finally {
      active--;
      notify();
      pump();
    }
  };

  const pump = () => {
    while (active < concurrency) {
      const next = queue.shift();
      if (!next) return;
      void start(next);
    }
  };

  return {
    want(urls) {
      urls.forEach(entry);
      pump();
    },
    prioritize(urls) {
      const front = urls.map(entry).filter((e) => e.state === "queued");
      for (const e of front) queue.splice(queue.indexOf(e), 1);
      queue.unshift(...front);
      pump();
    },
    bytes(url) {
      const had = entries.has(url);
      const e = entry(url);
      if (!had) this.prioritize([url]);
      return e.promise;
    },
    async fetch(url) {
      const buf = await this.bytes(url);
      return new Response(buf.slice(0), { status: 200 });
    },
    progress(urls) {
      let loaded = 0;
      let total = 0;
      let failed = 0;
      let done = true;
      for (const u of urls) {
        const e = entries.get(u);
        const size = e?.size || sizeOf(u);
        total += size;
        if (!e) {
          done = false;
          continue;
        }
        if (e.state === "failed") failed++;
        else loaded += Math.min(e.loaded, size || e.loaded);
        if (e.state !== "done" && e.state !== "failed") done = false;
      }
      return { loaded, total, done, failed };
    },
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
}

/** The page's one background streamer. Finished files go into three's cache for the scenes' loaders. */
export const assets = createAssets({
  sizes: SIZES,
  fetchImpl: (url) => fetch(url),
  base: import.meta.env.BASE_URL ?? "/",
  concurrency: 2,
  cache(url, buf) {
    THREE.Cache.enabled = true;
    THREE.Cache.add(url, buf);
  },
});
