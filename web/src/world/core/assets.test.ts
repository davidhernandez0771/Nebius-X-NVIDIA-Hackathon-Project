import { describe, expect, it, vi } from "vitest";
import { createAssets } from "./assets";

/** A fetch whose bodies arrive in the chunks given, one chunk per `step()` call. */
function streamingFetch(files: Record<string, number[]>) {
  const pending: (() => void)[] = [];
  const started: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    started.push(url);
    const chunks = files[url];
    if (!chunks) return { ok: false, status: 404, body: null } as unknown as Response;
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        return new Promise<void>((resolve) => {
          pending.push(() => {
            if (i < chunks.length) ctrl.enqueue(new Uint8Array(chunks[i++]));
            else ctrl.close();
            resolve();
          });
        });
      },
    });
    return { ok: true, status: 200, body } as unknown as Response;
  });
  /** Lets every open stream deliver its next chunk. */
  const step = async () => {
    const now = pending.splice(0);
    now.forEach((f) => f());
    for (let k = 0; k < 5; k++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { fetchImpl, step, started };
}

const SIZES = { "world/a.glb": 30, "world/b.glb": 20, "world/c.glb": 10 };
const url = (k: string) => `/${k}`;

describe("the background assets", () => {
  it("counts real bytes as they stream, against the files' known sizes", async () => {
    const f = streamingFetch({ "/world/a.glb": [10, 10, 10] });
    const a = createAssets({ sizes: SIZES, fetchImpl: f.fetchImpl as unknown as typeof fetch, base: "/" });
    a.want([url("world/a.glb")]);
    // The first step lets the stream ask for its first chunk; the next delivers it.
    await f.step();
    await f.step();
    expect(a.progress([url("world/a.glb")])).toEqual({ loaded: 10, total: 30, done: false, failed: 0 });
    await f.step();
    await f.step();
    await f.step();
    expect(a.progress([url("world/a.glb")])).toEqual({ loaded: 30, total: 30, done: true, failed: 0 });
  });

  it("fetches each file once however often it is wanted, and hands the same bytes to every asker", async () => {
    const f = streamingFetch({ "/world/a.glb": [30] });
    const a = createAssets({ sizes: SIZES, fetchImpl: f.fetchImpl as unknown as typeof fetch, base: "/" });
    a.want([url("world/a.glb")]);
    const p1 = a.bytes(url("world/a.glb"));
    const p2 = a.bytes(url("world/a.glb"));
    for (let i = 0; i < 3; i++) await f.step();
    const [b1, b2] = await Promise.all([p1, p2]);
    expect(b1).toBe(b2);
    expect(b1.byteLength).toBe(30);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    // And as a fetch Response, for the loaders that take a fetch (the crack, the robot models).
    const r = await a.fetch(url("world/a.glb"));
    expect(r.ok).toBe(true);
    expect((await r.arrayBuffer()).byteLength).toBe(30);
  });

  it("takes them in priority order, a few at a time, and jumps a file the visitor needs now to the front", async () => {
    const f = streamingFetch({ "/world/a.glb": [30], "/world/b.glb": [20], "/world/c.glb": [10] });
    const a = createAssets({ sizes: SIZES, fetchImpl: f.fetchImpl as unknown as typeof fetch, base: "/", concurrency: 1 });
    a.want([url("world/a.glb"), url("world/b.glb"), url("world/c.glb")]);
    a.prioritize([url("world/c.glb")]);
    await f.step();
    // a had already started; c goes next, before b.
    for (let i = 0; i < 6; i++) await f.step();
    expect(f.started).toEqual(["/world/a.glb", "/world/c.glb", "/world/b.glb"]);
  });

  it("hands each finished file to three's cache, so the scenes' own loaders find it there", async () => {
    const f = streamingFetch({ "/world/b.glb": [20] });
    const cached = new Map<string, ArrayBuffer>();
    const a = createAssets({ sizes: SIZES, fetchImpl: f.fetchImpl as unknown as typeof fetch, base: "/", cache: (k, buf) => cached.set(k, buf) });
    a.want([url("world/b.glb")]);
    for (let i = 0; i < 3; i++) await f.step();
    expect(cached.get("/world/b.glb")?.byteLength).toBe(20);
  });

  it("counts a file that fails as done (its scene falls back as it always has), and says so", async () => {
    const f = streamingFetch({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = createAssets({ sizes: SIZES, fetchImpl: f.fetchImpl as unknown as typeof fetch, base: "/" });
    a.want([url("world/c.glb")]);
    await f.step();
    expect(a.progress([url("world/c.glb")])).toEqual({ loaded: 0, total: 10, done: true, failed: 1 });
    await expect(a.bytes(url("world/c.glb"))).rejects.toThrow(/404/);
    warn.mockRestore();
  });

  it("tells subscribers as bytes arrive, and treats an empty list as ready", async () => {
    const f = streamingFetch({ "/world/a.glb": [15, 15] });
    const a = createAssets({ sizes: SIZES, fetchImpl: f.fetchImpl as unknown as typeof fetch, base: "/" });
    const heard = vi.fn();
    a.subscribe(heard);
    a.want([url("world/a.glb")]);
    for (let i = 0; i < 4; i++) await f.step();
    expect(heard.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(a.progress([])).toEqual({ loaded: 0, total: 0, done: true, failed: 0 });
  });
});
