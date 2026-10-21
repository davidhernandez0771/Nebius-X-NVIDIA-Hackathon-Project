import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import PipelinePage from "./PipelinePage";

class FakeSource {
  static all: FakeSource[] = [];
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((m: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 1;
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  close() {
    this.readyState = 2;
  }
  send(e: Record<string, unknown>) {
    act(() => this.onmessage?.({ data: JSON.stringify(e) } as MessageEvent));
  }
}

const SNAP = {
  type: "snapshot",
  id: "r1",
  name: "tonight's mouse demos",
  created: "2026-10-21T01:00:00Z",
  status: "running",
  gpu: { state: "queued", position: 1, holder: "T4 human-exp:x:train" },
  elapsed_s: 125,
  remaining_s: 3600,
  stages: [
    { id: "check", status: "done", progress: 1, detail: "10/10 passed" },
    { id: "repair", status: "running", progress: 0.5, eta_s: 30, items: { done: 5, total: 10, unit: "demo" }, eta_basis: "repair 6 s/demo" },
  ],
  check: [
    { demo: "human_20261020183738_00ab", success: true, reasons: [], duration: 14.2, path_length: 1.21, max_contact_force: 2.1, settle_time: 0.8 },
    { demo: "human_20261020183801_11cd", success: false, reasons: ["collision"], duration: 15.5, path_length: 1.4, max_contact_force: 41, settle_time: 1.2 },
  ],
  repair: [
    { demo: "human_20261020183801_11cd", status: "repaired", repairs: [{ op: "trim", t0: 0, t1: 1.2 }], before: { duration: 15.5, path_length: 1.4, max_contact_force: 41, settle_time: 1.2 }, after: { duration: 13.7, path_length: 1.3, max_contact_force: 3, settle_time: 0.8 }, output_id: "x_rules" },
  ],
  variants: [
    { id: "v1", source: "x_rules", seed: 3, success: true, reasons: [], frames: 0 },
    { id: "v2", source: "x_rules", seed: 4, success: false, reasons: ["dropped"], frames: 0 },
  ],
  train: { step: 2000, steps: 30000, loss: [[1000, 0.9], [2000, 0.6]], checkpoints: [{ step: 2000, name: "ckpt_2000.pt" }], eta_s: 1500 },
  evaluate: { seeds: [{ seed: 5020, success: true, reasons: [] }, { seed: 5021, success: false, reasons: ["dropped"] }], planned: 40 },
  artifacts: [{ name: "dataset.zip", kind: "dataset", bytes: 412_000_000, url: "/pipeline/runs/r1/artifacts/dataset.zip", sha256: "ab", note: "the verified demos" }],
};

function backend(over: Record<string, () => Response> = {}) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://x").pathname;
    const method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    const key = `${method} ${path}`;
    if (over[key]) return over[key]();
    if (key === "GET /pipeline/runs") return new Response(JSON.stringify({ runs: [{ id: "r1", name: "tonight's mouse demos", created: "2026-10-21T01:00:00Z", status: "running", stage: "repair", demos: 10 }] }));
    if (key === "POST /pipeline/estimate") return new Response(JSON.stringify({ demos: 2, remaining_s: 2400 }));
    if (key === "POST /pipeline/runs") return new Response(JSON.stringify({ id: "r9" }), { status: 201 });
    return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function show(path: string, f: typeof fetch) {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/pipeline" element={<PipelinePage fetchImpl={f} Source={FakeSource as never} />} />
          <Route path="/pipeline/:run" element={<PipelinePage fetchImpl={f} Source={FakeSource as never} />} />
          <Route path="/pipeline/:run/:stage" element={<PipelinePage fetchImpl={f} Source={FakeSource as never} />} />
        </Routes>
      </MemoryRouter>
    </MotionProvider>,
  );
}

const live = () => FakeSource.all[FakeSource.all.length - 1];

afterEach(() => {
  cleanup();
  FakeSource.all = [];
});

describe("the pipeline pages", () => {
  it("lists the runs, each with where it is", async () => {
    show("/pipeline", backend().f);
    const row = await screen.findByRole("link", { name: /tonight's mouse demos/i });
    expect(row.getAttribute("href")).toBe("/pipeline/r1");
    expect(row.textContent).toMatch(/repair/i);
  });

  it("says so when the pipeline API isn't on this server yet, and offers the example run", async () => {
    show("/pipeline", backend({ "GET /pipeline/runs": () => new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 }) }).f);
    expect(await screen.findByText(/isn't on this server yet/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /example run/i }).getAttribute("href")).toBe("/pipeline/example");
  });

  it("starts SANT on the demos just recorded: estimates first, then posts the recipe and opens the run", async () => {
    const { f, calls } = backend();
    show("/pipeline?demos=d1,d2", f);
    expect(await screen.findByText(/2 demos/i)).toBeTruthy();
    expect(await screen.findByText(/about 40 min/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /run sant/i }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/pipeline/runs")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.path === "/pipeline/runs")!.body).toMatchObject({ demos: ["d1", "d2"], preset: "standard" });
    await waitFor(() => expect(FakeSource.all.some((s) => s.url.includes("/pipeline/runs/r9/events"))).toBe(true));
  });

  it("says why it can't start when the server keeps the pipeline off", async () => {
    show("/pipeline?demos=d1", backend({ "POST /pipeline/runs": () => new Response(JSON.stringify({ detail: "pipeline is off (SANT_PIPELINE=1)" }), { status: 403 }) }).f);
    fireEvent.click(await screen.findByRole("button", { name: /run sant/i }));
    expect(await screen.findByText(/pipeline is off/i)).toBeTruthy();
  });

  it("shows the bar on every stage page: each stage's state, the time spent and left, and that it waits for the GPU", async () => {
    show("/pipeline/r1/check", backend().f);
    await waitFor(() => expect(FakeSource.all.length).toBe(1));
    live().send(SNAP);
    const bar = screen.getByRole("navigation", { name: /pipeline/i });
    expect(within(bar).getByRole("link", { name: /check/i }).getAttribute("data-status")).toBe("done");
    expect(within(bar).getByRole("link", { name: /repair/i }).getAttribute("data-status")).toBe("running");
    expect(bar.textContent).toMatch(/2 min 05 s/);
    expect(bar.textContent).toMatch(/1 h 00 min/);
    expect(screen.getByText(/waiting for the gpu \(1st in line; it's busy: T4/i)).toBeTruthy();
  });

  it("Check: each demo's physics verdict, and why one failed", async () => {
    show("/pipeline/r1/check", backend().f);
    await waitFor(() => expect(FakeSource.all.length).toBe(1));
    live().send(SNAP);
    expect(screen.getAllByText(/Physics: verified/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/arm pressed on the bin or table/i)).toBeTruthy();
  });

  it("Repair: what Neaten changed, before and after, and how far it has got", async () => {
    show("/pipeline/r1/repair", backend().f);
    await waitFor(() => expect(FakeSource.all.length).toBe(1));
    live().send(SNAP);
    expect(screen.getByText(/5 of 10 demos/i)).toBeTruthy();
    expect(screen.getByText(/repair 6 s\/demo/i)).toBeTruthy();
    const table = screen.getByRole("table");
    expect(table.textContent).toMatch(/41/);
    expect(table.textContent).toMatch(/3/);
  });

  it("Multiply: the variants as they arrive, each with its verdict", async () => {
    show("/pipeline/r1/multiply", backend().f);
    await waitFor(() => expect(FakeSource.all.length).toBe(1));
    live().send(SNAP);
    live().send({ type: "variant", id: "v3", source: "x_rules", seed: 5, success: true, reasons: [], frames: 0 });
    expect(within(screen.getByRole("list", { name: /variants/i })).getAllByRole("listitem").length).toBe(3);
    expect(screen.getByText(/2 of 3 verified/i)).toBeTruthy();
  });

  it("Multiply: a variant with camera frames shows the simulator's footage (the run's footage route)", async () => {
    const { f, calls } = backend({
      "GET /pipeline/runs/r1/footage/v7": () => new Response(JSON.stringify({ frames: 2, stride: 2, cols: 2, tile: [128, 128], fps: 50, url: "/showcase/sets/r1/footage/v7/sprite.jpg" })),
    });
    show("/pipeline/r1/multiply", f);
    await waitFor(() => expect(FakeSource.all.length).toBe(1));
    live().send(SNAP);
    live().send({ type: "variant", id: "v7", source: "x_rules", seed: 7, success: true, reasons: [], frames: 400 });
    await waitFor(() => expect(calls.some((c) => c.path === "/pipeline/runs/r1/footage/v7")).toBe(true));
    await waitFor(() => expect(screen.getByRole("img", { name: /variant 7/i }).getAttribute("style")).toMatch(/sprite\.jpg/));
  });

  it("Train: the step, the time left, the loss curve and the checkpoints", async () => {
    show("/pipeline/r1/train", backend().f);
    await waitFor(() => expect(FakeSource.all.length).toBe(1));
    live().send(SNAP);
    live().send({ type: "train", step: 3000, steps: 30000, loss: 0.4, eta_s: 1400 });
    expect(screen.getByText(/3,000 of 30,000 steps/i)).toBeTruthy();
    expect(screen.getByText(/23 min left/i)).toBeTruthy();
    expect(document.querySelector("svg path.pipe-loss__line")?.getAttribute("d")).toMatch(/^M/);
    expect(screen.getByText("ckpt_2000.pt")).toBeTruthy();
  });

  it("Evaluate: seed by seed, and the score out of the seeds run and planned", async () => {
    show("/pipeline/r1/evaluate", backend().f);
    await waitFor(() => expect(FakeSource.all.length).toBe(1));
    live().send(SNAP);
    expect(screen.getByText(/1 of 2 seeds succeeded \(40 planned\)/i)).toBeTruthy();
    expect(screen.getByTitle(/seed 5021: dropped/i)).toBeTruthy();
  });

  it("Export: the downloads, with their sizes", async () => {
    show("/pipeline/r1/export", backend().f);
    await waitFor(() => expect(FakeSource.all.length).toBe(1));
    live().send(SNAP);
    const link = screen.getByRole("link", { name: /dataset\.zip/i });
    expect(link.getAttribute("href")).toMatch(/\/pipeline\/runs\/r1\/artifacts\/dataset\.zip$/);
    expect(link.hasAttribute("download")).toBe(true);
    expect(screen.getByText(/412 MB/)).toBeTruthy();
  });
});
