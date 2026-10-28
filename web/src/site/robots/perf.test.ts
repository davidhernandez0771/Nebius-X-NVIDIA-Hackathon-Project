import { describe, expect, it } from "vitest";
import { PerfProbe, readPerfConfig } from "./perf";

describe("readPerfConfig", () => {
  it("is off by default", () => {
    expect(readPerfConfig("")).toEqual({ on: false, dpr: null, sweep: false, sync: false, tier: null });
  });

  it("turns on with ?perf and reads a DPR override, the scripted sweep and GPU sync", () => {
    expect(readPerfConfig("?perf&dpr=1.5&sweep&sync&tier=2")).toEqual({ on: true, dpr: 1.5, sweep: true, sync: true, tier: 2 });
  });

  it("ignores a DPR that is not a sane positive number", () => {
    expect(readPerfConfig("?perf&dpr=abc").dpr).toBeNull();
    expect(readPerfConfig("?perf&dpr=0").dpr).toBeNull();
    expect(readPerfConfig("?perf&dpr=9").dpr).toBeNull();
  });

  it("ignores a tier outside 0..2", () => {
    expect(readPerfConfig("?perf&tier=3").tier).toBeNull();
  });

  it("only sweeps or syncs when perf is on", () => {
    expect(readPerfConfig("?sweep&sync")).toMatchObject({ sweep: false, sync: false });
  });
});

describe("PerfProbe", () => {
  const info = (calls: number, textures: number, programs: number) => ({
    render: { calls, triangles: calls * 10 },
    memory: { textures, geometries: 3 },
    programs: { length: programs },
  });

  it("logs a hitch with what changed in that frame", () => {
    const p = new PerfProbe(50);
    p.frame({ now: 0, cpuMs: 2, info: info(10, 5, 2), scroll: 0.1, selected: null });
    p.frame({ now: 16, cpuMs: 2, info: info(10, 5, 2), scroll: 0.1, selected: null });
    p.frame({ now: 116, cpuMs: 70, info: info(10, 8, 3), scroll: 0.2, selected: null });
    expect(p.hitches).toHaveLength(1);
    expect(p.hitches[0]).toMatchObject({ intervalMs: 100, cpuMs: 70, newTextures: 3, newPrograms: 1 });
    expect(p.frames.max()).toBe(100);
    expect(p.last.calls).toBe(10);
  });

  it("does not count the first frame as an interval", () => {
    const p = new PerfProbe(50);
    p.frame({ now: 5000, cpuMs: 1, info: info(1, 1, 1), scroll: 0, selected: null });
    expect(p.frames.count()).toBe(0);
  });
});
