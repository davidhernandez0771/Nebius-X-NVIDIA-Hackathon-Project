// The ?perf probe: frame intervals, CPU time per frame, renderer counters and a log of hitches with what changed
// in that frame (new textures uploaded, new shader programs). ?dpr=1.5 forces the render DPR; ?sweep scrolls the
// pile with synthetic wheel events so runs are comparable; ?tier=0..2 pins a quality tier; ?sync reads back one pixel after each render, so the
// frame's CPU time includes waiting for the GPU (true GPU cost, slightly pessimistic).
import { FrameStats } from "./perfStats";

export type PerfConfig = { on: boolean; dpr: number | null; sweep: boolean; sync: boolean; tier: number | null };

export function readPerfConfig(search: string): PerfConfig {
  const q = new URLSearchParams(search);
  const on = q.has("perf");
  const d = Number(q.get("dpr"));
  const t = q.get("tier");
  return {
    on,
    dpr: on && Number.isFinite(d) && d > 0 && d <= 4 ? d : null,
    sweep: on && q.has("sweep"),
    sync: on && q.has("sync"),
    tier: on && t !== null && /^[0-2]$/.test(t) ? Number(t) : null,
  };
}

/** The slice of WebGLRenderer.info the probe reads. */
export type RendererInfo = {
  render: { calls: number; triangles: number };
  memory: { textures: number; geometries: number };
  programs: { length: number } | null;
};

export type Hitch = { at: number; intervalMs: number; cpuMs: number; newTextures: number; newPrograms: number; scroll: number; selected: number | null };

export class PerfProbe {
  frames = new FrameStats(600);
  cpu = new FrameStats(600);
  hitches: Hitch[] = [];
  last = { calls: 0, triangles: 0, textures: 0, geometries: 0, programs: 0 };
  /** Extra numbers shown as-is (canvas size, DPR, GPU memory estimate…). */
  meta: Record<string, string | number> = {};
  /** Main-thread long tasks (PerformanceObserver "longtask") in this window: count and the worst one. */
  longTasks = { count: 0, maxMs: 0 };
  private prev = -1;

  constructor(private hitchMs = 50) {}

  longTask(durationMs: number) {
    this.longTasks.count++;
    this.longTasks.maxMs = Math.max(this.longTasks.maxMs, Math.round(durationMs));
  }

  frame(f: { now: number; cpuMs: number; info: RendererInfo; scroll: number; selected: number | null }) {
    const programs = f.info.programs?.length ?? 0;
    const interval = this.prev < 0 ? -1 : f.now - this.prev;
    if (interval >= 0) {
      this.frames.push(interval);
      this.cpu.push(f.cpuMs);
      if (interval > this.hitchMs && this.hitches.length < 200)
        this.hitches.push({
          at: Math.round(f.now),
          intervalMs: Math.round(interval),
          cpuMs: Math.round(f.cpuMs * 10) / 10,
          newTextures: f.info.memory.textures - this.last.textures,
          newPrograms: programs - this.last.programs,
          scroll: Math.round(f.scroll * 1000) / 1000,
          selected: f.selected,
        });
    }
    this.prev = f.now;
    this.last = { calls: f.info.render.calls, triangles: f.info.render.triangles, textures: f.info.memory.textures, geometries: f.info.memory.geometries, programs };
  }

  /** Starts a fresh measurement window (keeps the renderer counters). */
  reset() {
    this.frames.reset();
    this.cpu.reset();
    this.hitches = [];
    this.prev = -1;
    this.longTasks = { count: 0, maxMs: 0 };
  }

  summary() {
    const r = (x: number) => Math.round(x * 10) / 10;
    return {
      fps: r(this.frames.fps()),
      p95Ms: r(this.frames.p95()),
      maxMs: r(this.frames.max()),
      hitches50: this.frames.over(50),
      cpuP95Ms: r(this.cpu.p95()),
      cpuMeanMs: r(1000 / Math.max(1e-9, this.cpu.fps())),
      frames: this.frames.count(),
      longTasks: this.longTasks.count,
      longTaskMaxMs: this.longTasks.maxMs,
      ...this.last,
      ...this.meta,
    };
  }
}

