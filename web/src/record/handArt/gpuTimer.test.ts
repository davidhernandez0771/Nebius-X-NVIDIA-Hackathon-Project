import { describe, expect, it } from "vitest";
import { GpuTimer } from "./gpuTimer";

const EXT = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };

function fakeGl(opts: { ext?: boolean } = {}) {
  const results = new Map<object, { available: boolean; ns: number }>();
  const state = { disjoint: false, begun: 0, deleted: 0, active: null as object | null };
  const gl = {
    QUERY_RESULT: 1,
    QUERY_RESULT_AVAILABLE: 2,
    getExtension: (name: string) => (opts.ext !== false && name === "EXT_disjoint_timer_query_webgl2" ? EXT : null),
    createQuery: () => {
      const q = {};
      results.set(q, { available: false, ns: 0 });
      return q;
    },
    beginQuery: (_t: number, q: object) => {
      state.begun++;
      state.active = q;
    },
    endQuery: () => (state.active = null),
    getQueryParameter: (q: object, p: number) => (p === 2 ? results.get(q)!.available : results.get(q)!.ns),
    getParameter: (p: number) => (p === EXT.GPU_DISJOINT_EXT ? state.disjoint : 0),
    deleteQuery: () => state.deleted++,
  };
  const finish = (ns: number) => {
    for (const r of results.values()) if (!r.available) {
      r.available = true;
      r.ns = ns;
      return;
    }
  };
  return { gl: gl as unknown as WebGL2RenderingContext, state, finish };
}

describe("GpuTimer", () => {
  it("is null without the timer-query extension", () => {
    expect(GpuTimer.create(fakeGl({ ext: false }).gl)).toBeNull();
  });

  it("returns each frame's GPU time in ms once the GPU has it", () => {
    const f = fakeGl();
    const t = GpuTimer.create(f.gl)!;
    t.begin();
    t.end();
    expect(t.poll()).toEqual([]);
    f.finish(2_500_000);
    expect(t.poll()).toEqual([2.5]);
    expect(f.state.deleted).toBe(1);
  });

  it("drops results from a disjoint period", () => {
    const f = fakeGl();
    const t = GpuTimer.create(f.gl)!;
    t.begin();
    t.end();
    f.finish(1_000_000);
    f.state.disjoint = true;
    expect(t.poll()).toEqual([]);
  });

  it("keeps a bounded number of queries in flight", () => {
    const f = fakeGl();
    const t = GpuTimer.create(f.gl)!;
    for (let i = 0; i < 20; i++) {
      t.begin();
      t.end();
    }
    expect(f.state.begun).toBeLessThanOrEqual(4);
  });
});
