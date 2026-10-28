// An example run, played in the browser until the pipeline API lands (pm/pipeline-api): the events a real run sends,
// on a scripted clock, through an EventSource look-alike, so the pages run the same code either way. Its numbers are
// shaped on tonight's mouse experiment (10 demos through physics, rules repairs, a 30k-step training, 40 seeds) but it
// is an example, and the pages say so. Deterministic.
import { PIPELINE_STAGES, type DemosStageId, type RunEvent } from "./model";

export const EXAMPLE_RUN_ID = "example";

export type ScriptStep = { at: number; event: RunEvent };

/** Seeded noise, so the example is the same every time. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const DEMOS = Array.from({ length: 10 }, (_, i) => `example_${String(i + 1).padStart(2, "0")}`);
const PER = { check: 23, repair: 6, variant: 8, train: 1800, seed: 20, export: 12 };
const VARIANTS_PER_DEMO = 3;
const STEPS = 30000;
const SEEDS = 40;
/** Which of the 40 seeds succeed (17 of them). */
const WINS = new Set([1, 3, 4, 7, 9, 12, 14, 15, 18, 21, 24, 26, 29, 31, 33, 36, 38]);

/** The example run's events, each at its time (seconds from the start). */
export function exampleScript(): ScriptStep[] {
  const rnd = seeded(20261021);
  const out: ScriptStep[] = [];
  let t = 0;
  const at = (dt: number, event: RunEvent) => {
    t += dt;
    out.push({ at: t, event });
  };
  const stage = (stage: DemosStageId, patch: Record<string, unknown>) => ({ type: "stage", stage, ...patch });

  const plan: Record<DemosStageId, number> = {
    check: DEMOS.length * PER.check,
    repair: DEMOS.length * PER.repair,
    multiply: DEMOS.length * VARIANTS_PER_DEMO * PER.variant,
    train: PER.train,
    evaluate: SEEDS * PER.seed,
    export: PER.export,
  };
  at(0, {
    type: "snapshot",
    id: EXAMPLE_RUN_ID,
    name: "Example run: 10 mouse demos",
    created: "2026-10-21T01:00:00Z",
    status: "queued",
    gpu: { state: "queued", position: 1, holder: "training (another run)" },
    elapsed_s: 0,
    remaining_s: Object.values(plan).reduce((a, b) => a + b, 0) + 20,
    stages: PIPELINE_STAGES.map((s) => ({ id: s.id, status: "pending", progress: 0, eta_s: plan[s.id], detail: null })),
    evaluate: { seeds: [], planned: SEEDS },
    train: { step: 0, steps: STEPS, loss: [], checkpoints: [], eta_s: PER.train },
  });
  at(20, { type: "gpu", state: "running", position: null, holder: null });

  // Check: each demo replayed with physics on.
  at(0, stage("check", { status: "running", progress: 0, items: { done: 0, total: DEMOS.length, unit: "demo" }, eta_basis: "physics 23 s/demo, measured" }));
  DEMOS.forEach((demo, i) => {
    at(PER.check, {
      type: "check",
      demo,
      success: true,
      reasons: [],
      duration: +(14 + rnd() * 6).toFixed(2),
      path_length: +(1.1 + rnd() * 0.5).toFixed(3),
      max_contact_force: +(0.5 + rnd() * 3).toFixed(2),
      settle_time: +(0.6 + rnd() * 0.5).toFixed(2),
      frames: 400,
    });
    at(0, stage("check", { progress: (i + 1) / DEMOS.length, eta_s: (DEMOS.length - i - 1) * PER.check, items: { done: i + 1, total: DEMOS.length, unit: "demo" }, detail: `physics ${i + 1}/${DEMOS.length}` }));
  });
  at(0, stage("check", { status: "done", progress: 1, eta_s: 0, detail: `${DEMOS.length}/${DEMOS.length} passed` }));

  // Repair: Neaten's rules (trim the idle start, smooth the shakes), each re-verified.
  at(0, stage("repair", { status: "running", progress: 0, items: { done: 0, total: DEMOS.length, unit: "demo" } }));
  DEMOS.forEach((demo, i) => {
    const before = { duration: +(15 + rnd() * 5).toFixed(2), path_length: +(1.3 + rnd() * 0.4).toFixed(3), max_contact_force: +(1 + rnd() * 3).toFixed(2), settle_time: 0.9 };
    at(PER.repair, {
      type: "repair",
      demo,
      status: "repaired",
      repairs: [{ op: "trim", t0: 0, t1: +(1 + rnd() * 2).toFixed(1) }, { op: "smooth", t0: 2, t1: +(8 + rnd() * 4).toFixed(1) }],
      before,
      after: { duration: +(before.duration - 1.8).toFixed(2), path_length: +(before.path_length - 0.12).toFixed(3), max_contact_force: +(before.max_contact_force * 0.7).toFixed(2), settle_time: 0.7 },
      output_id: `${demo}_rules`,
    });
    at(0, stage("repair", { progress: (i + 1) / DEMOS.length, eta_s: (DEMOS.length - i - 1) * PER.repair, items: { done: i + 1, total: DEMOS.length, unit: "demo" } }));
  });
  at(0, stage("repair", { status: "done", progress: 1, eta_s: 0, detail: "10 repaired, all re-verified" }));

  // Multiply: three variants per repaired demo, cube and bin moved; physics checks each.
  const nVar = DEMOS.length * VARIANTS_PER_DEMO;
  at(0, stage("multiply", { status: "running", progress: 0, items: { done: 0, total: nVar, unit: "variant" } }));
  for (let i = 0; i < nVar; i++) {
    const source = `${DEMOS[Math.floor(i / VARIANTS_PER_DEMO)]}_rules`;
    const ok = rnd() > 0.15;
    at(PER.variant, { type: "variant", id: `${source}_m${i}`, source, seed: i, success: ok, reasons: ok ? [] : ["not_in_bin"], frames: 0 });
    at(0, stage("multiply", { progress: (i + 1) / nVar, eta_s: (nVar - i - 1) * PER.variant, items: { done: i + 1, total: nVar, unit: "variant" }, detail: `variant ${i + 1}/${nVar}` }));
  }
  at(0, stage("multiply", { status: "done", progress: 1, eta_s: 0 }));

  // Train: the loss falling over 30k steps, a checkpoint every 10k.
  at(0, stage("train", { status: "running", progress: 0, items: { done: 0, total: STEPS, unit: "step" } }));
  const points = 24;
  for (let k = 1; k <= points; k++) {
    const step = Math.round((STEPS * k) / points);
    const loss = +(1.2 * Math.exp(-step / 6000) + 0.02 + rnd() * 0.01).toFixed(4);
    at(PER.train / points, { type: "train", step, steps: STEPS, loss, eta_s: Math.round(PER.train * (1 - k / points)), cell: "perfected_multiply_10" });
    if (step % 10000 === 0) at(0, { type: "checkpoint", step, name: `ckpt_${step}.pt` });
    at(0, stage("train", { progress: k / points, eta_s: Math.round(PER.train * (1 - k / points)), items: { done: step, total: STEPS, unit: "step" }, detail: `step ${step}/${STEPS}` }));
  }
  at(0, stage("train", { status: "done", progress: 1, eta_s: 0 }));

  // Evaluate: 40 unseen scenes.
  at(0, stage("evaluate", { status: "running", progress: 0, items: { done: 0, total: SEEDS, unit: "seed" } }));
  for (let i = 0; i < SEEDS; i++) {
    const success = WINS.has(i);
    at(PER.seed, { type: "evaluate", seed: 5020 + i, success, reasons: success ? [] : [rnd() > 0.3 ? "dropped" : "not_in_bin"], cell: "perfected_multiply_10" });
    at(0, stage("evaluate", { progress: (i + 1) / SEEDS, eta_s: (SEEDS - i - 1) * PER.seed, items: { done: i + 1, total: SEEDS, unit: "seed" }, detail: `seed ${i + 1}/${SEEDS}` }));
  }
  at(0, stage("evaluate", { status: "done", progress: 1, eta_s: 0, detail: "17/40" }));

  // Export.
  at(0, stage("export", { status: "running", progress: 0 }));
  at(PER.export / 2, { type: "artifact", name: "dataset.zip", kind: "dataset", bytes: 412_000_000, url: "", sha256: null, note: "the verified demos and variants (LeRobot layout)" });
  at(PER.export / 4, { type: "artifact", name: "robota_export.jsonl", kind: "robota", bytes: 2_300_000, url: "", note: "anchors with Nemotron phrasings" });
  at(PER.export / 4, { type: "artifact", name: "report.md", kind: "report", bytes: 18_000, url: "", note: "what each stage did, with its numbers" });
  at(0, stage("export", { status: "done", progress: 1, eta_s: 0 }));
  at(0, { type: "end", status: "done" });

  // The clock: elapsed and left after every step.
  const total = out[out.length - 1].at;
  return out.flatMap((s) => [s, { at: s.at, event: { type: "run", elapsed_s: s.at, remaining_s: Math.max(0, total - s.at), status: s.at >= 20 && s.event.type !== "end" ? "running" : undefined } }]).filter((s, i, all) => !(s.event.type === "run" && i === all.length - 1));
}

/** The example run as an EventSource: each event a message at its time, `speed` times faster than real. */
export class StubSource {
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(readonly url: string, speed = 30) {
    const start = setTimeout(() => {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
      for (const step of exampleScript())
        this.timers.push(
          setTimeout(() => {
            if (this.readyState === 2) return;
            this.onmessage?.({ data: JSON.stringify(step.event) } as MessageEvent);
            if (step.event.type === "end") this.readyState = 2;
          }, (step.at * 1000) / speed),
        );
    }, 0);
    this.timers.push(start);
  }

  close() {
    this.readyState = 2;
    this.timers.forEach(clearTimeout);
  }
}
