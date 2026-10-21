import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRunEvent, emptyRun, PIPELINE_STAGES, stageOf, type RunState } from "./model";
import { EXAMPLE_RUN_ID, exampleScript, StubSource } from "./stub";

const play = () => exampleScript().reduce<RunState>((s, step) => applyRunEvent(s, step.event), emptyRun(EXAMPLE_RUN_ID));

describe("the example run (until the pipeline API lands)", () => {
  it("starts with a snapshot, waits for the GPU, then runs every stage in order to the end", () => {
    const script = exampleScript();
    expect(script[0].event.type).toBe("snapshot");
    // Queued behind another run first (in the snapshot), then the GPU is ours.
    expect((script[0].event.gpu as { state: string }).state).toBe("queued");
    expect(script.some((s) => s.event.type === "gpu" && s.event.state === "running")).toBe(true);
    const order = script.filter((s) => s.event.type === "stage" && s.event.status === "running").map((s) => s.event.stage);
    expect(order).toEqual(PIPELINE_STAGES.map((s) => s.id));
    expect(script[script.length - 1].event).toMatchObject({ type: "end", status: "done" });
    for (let i = 1; i < script.length; i++) expect(script[i].at).toBeGreaterThanOrEqual(script[i - 1].at);
  });

  it("ends with every stage done and something in each: verdicts, repairs, variants, a loss curve, seeds, downloads", () => {
    const r = play();
    for (const s of PIPELINE_STAGES) expect(stageOf(r, s.id).status).toBe("done");
    expect(r.check.length).toBeGreaterThan(0);
    expect(r.repair.length).toBeGreaterThan(0);
    expect(r.variants.length).toBeGreaterThan(0);
    expect(r.train.loss.length).toBeGreaterThan(5);
    expect(r.evaluate.seeds.length).toBe(r.evaluate.planned);
    expect(r.artifacts.map((a) => a.kind).sort()).toEqual(["dataset", "report", "robota"]);
    expect(r.name).toMatch(/example/i);
  });

  it("plays like an EventSource: opens, sends each event as a message at its time (sped up), closes after the end", async () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const src = new StubSource("stub://example", 100);
    let opened = false;
    src.onopen = () => (opened = true);
    src.onmessage = (m) => got.push(JSON.parse(String(m.data)).type);
    await vi.advanceTimersByTimeAsync(10);
    expect(opened).toBe(true);
    expect(got[0]).toBe("snapshot");
    const script = exampleScript();
    const total = script[script.length - 1].at;
    await vi.advanceTimersByTimeAsync((total * 1000) / 100 + 100);
    expect(got[got.length - 1]).toBe("end");
    expect(src.readyState).toBe(2);
    src.close();
    vi.useRealTimers();
  });
});

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());
