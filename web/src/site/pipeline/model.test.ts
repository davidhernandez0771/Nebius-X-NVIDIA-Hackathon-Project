import { describe, expect, it } from "vitest";
import {
  PIPELINE_STAGES, applyRunEvent, barOf, emptyRun, evalScore, formatDuration, lossPath, parseRun, parseRunEvent, parseRuns, stageOf,
  type RunState,
} from "./model";

const SNAP = {
  id: "r1",
  name: "mouse demos",
  created: "2026-10-21T01:00:00Z",
  status: "running",
  gpu: { state: "running", position: null, holder: "T2" },
  elapsed_s: 300,
  remaining_s: 1500,
  stages: [
    { id: "check", status: "done", progress: 1, eta_s: null, started: 1, finished: 60, detail: "10 demos" },
    { id: "repair", status: "running", progress: 0.4, eta_s: 90, started: 60, finished: null, detail: null },
  ],
  check: [{ demo: "d1", success: false, reasons: ["collision"], duration: 12, path_length: 1.2, max_contact_force: 30, settle_time: 1 }],
  repair: [],
  variants: [],
  train: { step: 0, steps: 30000, loss: [], checkpoints: [], eta_s: null },
  evaluate: { seeds: [], planned: 40 },
  artifacts: [],
};

describe("the pipeline's model", () => {
  it("lists SANT's stages after Record, in order, each its own page", () => {
    expect(PIPELINE_STAGES.map((s) => s.id)).toEqual(["check", "repair", "multiply", "train", "evaluate", "export"]);
    expect(PIPELINE_STAGES.map((s) => s.label)).toEqual(["Check", "Repair", "Multiply", "Train", "Evaluate", "Export"]);
  });

  it("reads a run's snapshot, filling every stage (missing ones pending) and tolerating missing parts", () => {
    const r = parseRun(SNAP);
    expect(r.stages.map((s) => s.id)).toEqual(PIPELINE_STAGES.map((s) => s.id));
    expect(stageOf(r, "repair")).toMatchObject({ status: "running", progress: 0.4, eta_s: 90 });
    expect(stageOf(r, "train").status).toBe("pending");
    expect(r.check[0]).toMatchObject({ demo: "d1", success: false, reasons: ["collision"] });
    expect(parseRun({ id: "x" }).stages).toHaveLength(6);
    expect(parseRun({ id: "x" }).gpu.state).toBe("idle");
  });

  it("reads the run list", () => {
    expect(parseRuns({ runs: [{ id: "r1", name: "n", created: "c", status: "done", stage: "export", demos: 10 }] })).toEqual([
      { id: "r1", name: "n", created: "c", status: "done", stage: "export", demos: 10, detail: null, resumable: false },
    ]);
    expect(parseRuns({})).toEqual([]);
  });

  it("applies the live events: a snapshot replaces, patches merge, rows are added or updated by their key", () => {
    let s: RunState = emptyRun("r1");
    s = applyRunEvent(s, { type: "snapshot", ...SNAP });
    s = applyRunEvent(s, { type: "stage", stage: "repair", status: "done", progress: 1, eta_s: null, finished: 150 });
    s = applyRunEvent(s, { type: "check", demo: "d1", success: true, reasons: [] });
    s = applyRunEvent(s, { type: "check", demo: "d2", success: false, reasons: ["dropped"] });
    s = applyRunEvent(s, { type: "variant", id: "v1", source: "d1", seed: 3, success: true, reasons: [], frames: 120 });
    s = applyRunEvent(s, { type: "train", step: 1000, steps: 30000, loss: 0.8, eta_s: 1200 });
    s = applyRunEvent(s, { type: "train", step: 2000, steps: 30000, loss: 0.5, eta_s: 1100 });
    s = applyRunEvent(s, { type: "checkpoint", step: 2000, name: "ckpt_2000.pt" });
    s = applyRunEvent(s, { type: "evaluate", seed: 5020, success: true, reasons: [] });
    s = applyRunEvent(s, { type: "artifact", name: "dataset.zip", kind: "dataset", bytes: 1024, url: "/x/dataset.zip" });
    s = applyRunEvent(s, { type: "gpu", state: "queued", position: 2, holder: "T4" });
    expect(stageOf(s, "repair")).toMatchObject({ status: "done", progress: 1, finished: 150 });
    expect(s.check.map((c) => [c.demo, c.success])).toEqual([["d1", true], ["d2", false]]);
    expect(s.variants).toHaveLength(1);
    expect(s.train).toMatchObject({ step: 2000, steps: 30000, loss: [[1000, 0.8], [2000, 0.5]], eta_s: 1100 });
    expect(s.train.checkpoints).toEqual([{ step: 2000, name: "ckpt_2000.pt" }]);
    expect(s.evaluate.seeds).toEqual([{ seed: 5020, success: true, reasons: [], cell: null }]);
    expect(s.artifacts[0]).toMatchObject({ name: "dataset.zip", kind: "dataset" });
    expect(s.gpu).toEqual({ state: "queued", position: 2, holder: "T4" });
    s = applyRunEvent(s, { type: "end", status: "done" });
    expect(s.status).toBe("done");
  });

  it("reads T5's additions: why a run stopped and if it can resume, a stage's items, own time and the basis of its estimate, the eval cell, the artifacts' checksums, the log", () => {
    const r = parseRun({
      ...SNAP,
      status: "failed",
      detail: "stopped before train; resumable",
      resumable: true,
      stages: [{ id: "check", status: "running", progress: 0.3, items: { done: 3, total: 10, unit: "demo" }, elapsed_s: 69, eta_basis: "physics 23 s/demo, measured: median of 68", detail: "physics 3/10" }],
      evaluate: { seeds: [{ seed: 5020, success: true, reasons: [], cell: "raw_10" }], planned: 80 },
      train: { step: 10, steps: 100, loss: [], checkpoints: [], eta_s: 5, cell: "perfected_multiply_10" },
      artifacts: [{ name: "report.md", kind: "report", bytes: 10, url: "/u", sha256: "ab12", note: "the results" }],
    });
    expect(r).toMatchObject({ detail: "stopped before train; resumable", resumable: true });
    expect(stageOf(r, "check")).toMatchObject({ items: { done: 3, total: 10, unit: "demo" }, elapsed_s: 69, eta_basis: "physics 23 s/demo, measured: median of 68" });
    expect(stageOf(r, "train").items).toBeNull();
    expect(r.evaluate.seeds[0].cell).toBe("raw_10");
    expect(r.train.cell).toBe("perfected_multiply_10");
    expect(r.artifacts[0]).toMatchObject({ sha256: "ab12", note: "the results" });
    let s = r;
    for (let i = 0; i < 60; i++) s = applyRunEvent(s, { type: "log", line: `line ${i}` });
    expect(s.log).toHaveLength(40);
    expect(s.log[39]).toBe("line 59");
    expect(parseRuns({ runs: [{ id: "a", status: "failed", detail: "refused: no human demo matches", resumable: false }] })[0]).toMatchObject({ detail: "refused: no human demo matches", resumable: false });
  });

  it("ignores events it doesn't know, and bad JSON", () => {
    const s = parseRun(SNAP);
    expect(applyRunEvent(s, { type: "whatever" })).toBe(s);
    expect(parseRunEvent("not json")).toBeNull();
    expect(parseRunEvent('{"type":"gpu","state":"idle"}')).toMatchObject({ type: "gpu" });
  });

  it("tells the bar where the run is: the current stage, time spent and left, and when it waits for the GPU", () => {
    const r = parseRun(SNAP);
    expect(barOf(r)).toMatchObject({ current: "repair", waiting: null, elapsed: "5 min 00 s", remaining: "25 min" });
    const queued = applyRunEvent(r, { type: "gpu", state: "queued", position: 2, holder: "training" });
    expect(barOf(queued).waiting).toBe("Waiting for the GPU (2nd in line; it's busy: training)");
    const done = applyRunEvent(r, { type: "end", status: "done" });
    expect(barOf(done)).toMatchObject({ current: null, remaining: "done" });
  });

  it("writes durations as people read them", () => {
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(185)).toBe("3 min 05 s");
    expect(formatDuration(1500)).toBe("25 min");
    expect(formatDuration(4320)).toBe("1 h 12 min");
    expect(formatDuration(null)).toBe("—");
  });

  it("scores the evaluation as successes out of the seeds run, and of those planned", () => {
    const r = applyRunEvent(applyRunEvent(parseRun(SNAP), { type: "evaluate", seed: 1, success: true, reasons: [] }), { type: "evaluate", seed: 2, success: false, reasons: ["dropped"] });
    expect(evalScore(r)).toEqual({ k: 1, run: 2, planned: 40 });
  });

  it("draws the loss curve as an SVG path in the box (log scale, first step at the left)", () => {
    const d = lossPath([[0, 1], [100, 0.1], [200, 0.01]], 200, 100);
    expect(d.startsWith("M0.0,")).toBe(true);
    const ys = [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys[0]).toBeLessThan(ys[2]); // falling loss goes down the box
    expect(lossPath([], 200, 100)).toBe("");
  });
});
