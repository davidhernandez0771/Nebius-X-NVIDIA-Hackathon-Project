import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import { clearShowcaseCache } from "./api";
import DataPage from "./DataPage";

vi.mock("../../twin", () => ({
  RobotTwin: (p: { caption?: string }) => <div data-testid="twin">{p.caption}</div>,
}));

const V = (over: Record<string, unknown> = {}) => ({ success: true, reasons: [], duration: 8.34, path_length: 1.0109, max_contact_force: 0, settle_time: 1.4, ...over });

const SETS = [
  { name: "human10c", input: "webcam", n_demos: 1, replay_verified: 0, repaired: 1, variants_verified: 1, variants_total: 2, evals: [{ cell: "perfected_multiply_10", k: 3, n: 40 }] },
  { name: "mouse20261020", input: "mouse", n_demos: 1, replay_verified: 1, repaired: 1, variants_verified: 2, variants_total: 2, evals: [] },
];

const SET = {
  name: "mouse20261020",
  input: "mouse",
  repair: "rules",
  demos: [
    {
      id: "human_20261020183738_00ab", live: true, live_frames: 418, replay: { ...V(), frames: 418 },
      repair: { status: "perfected", decision: "repair", diagnosis_source: "rules", output_id: "human_20261020183738_00ab_rules",
        repairs: [{ t0: 0.76, t1: 7.68, op: "trim" }], issues: [{ type: "idle_start_end", evidence: "still for the first 0.76 s", t0: 0, t1: 0.76 }],
        before: V(), after: V({ duration: 6.92 }) },
      repaired: { id: "human_20261020183738_00ab_rules", success: true, frames: 347 },
      variants: [
        { id: "human_20261020183738_00ab_rules_home_m3100", seed: 3100, success: true, reasons: [], frames: 404 },
        { id: "human_20261020183738_00ab_rules_home_m3101", seed: 3101, success: false, reasons: ["dropped"], frames: 404 },
      ],
    },
  ],
};

const EPISODE = (id: string) => ({
  demo_id: id, source: "human", robot: "franka", fps: 50, n_steps: 4, joint_names: ["panda_joint1"], joint_pos: [[0], [0.1], [0.2], [0.3]],
  gripper: [0, 0, 1, 0], cube_pos: null, cube_quat: [1, 0, 0, 0], bin: [0.5, 0.2, 0, 1, 0, 0, 0], base: [0, 0, 0, 1, 0, 0, 0], verified: true, lineage: [id],
});

const FOOTAGE = { frames: 2, stride: 2, cols: 2, tile: [128, 128], fps: 50, url: "/showcase/sets/x/footage/y/sprite.jpg?camera=front&live=false" };

function backend() {
  return vi.fn(async (url: string) => {
    const path = new URL(url, "http://x").pathname;
    const body = path === "/showcase/sets" ? SETS
      : path === "/showcase/sets/mouse20261020" ? SET
      : path.includes("/episodes/") ? EPISODE(decodeURIComponent(path.split("/").pop()!))
      : path.includes("/footage/") ? FOOTAGE
      : null;
    return new Response(JSON.stringify(body ?? { detail: "Not Found" }), { status: body ? 200 : 404 });
  }) as unknown as typeof fetch;
}

class FakeSource {
  static all: FakeSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  closed = false;
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(e: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(e) } as MessageEvent);
  }
}

function page(url = "/data", fetchImpl = backend()) {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={[url]}>
        <DataPage fetchImpl={fetchImpl} Source={FakeSource as unknown as typeof EventSource} />
      </MemoryRouter>
    </MotionProvider>,
  );
}

beforeEach(() => {
  clearShowcaseCache();
  FakeSource.all = [];
  vi.stubGlobal("matchMedia", vi.fn((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the data page", () => {
  // site-bugs (2026-10-26): with no backend (a judge's machine) the page said "The experiments didn't load: Failed to
  // fetch" over an empty page, with nowhere to go.
  it("without the backend, says so in words and points to the pages that work without it", async () => {
    page("/data", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch);
    const note = await screen.findByRole("status");
    expect(note.textContent).not.toMatch(/Failed to fetch/);
    expect(note.textContent).toMatch(/Can't reach the backend/);
    expect(within(note).getByRole("link", { name: /test track/i }).getAttribute("href")).toBe("/test-track");
    expect(within(note).getByRole("link", { name: /results/i }).getAttribute("href")).toBe("/site/results");
  });

  it("sits in the holo frame, at the end of the path Record › Pipeline › Data", async () => {
    page();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The data");
    const path = screen.getByRole("navigation", { name: "Pages" });
    expect(within(path).getByRole("link", { name: "Data" }).getAttribute("aria-current")).toBe("page");
    expect(within(path).getByRole("link", { name: "Pipeline" }).getAttribute("href")).toBe("/pipeline");
    // The panes are holo panels, their state from the physics verdict.
    const panes = await screen.findAllByRole("region", { name: /Live|Repaired/ });
    expect(panes.map((p) => [p.classList.contains("holo-panel"), p.dataset.holoState])).toEqual([[true, undefined], [true, "pass"]]);
  });

  it("opens on tonight's mouse demos, the human's take next to what SANT repaired", async () => {
    page();
    expect(await screen.findByText(/1 mouse demos · 1\/1 passed the physics replay · 1 repaired · 2\/2 variants verified/)).toBeTruthy();
    const panes = await screen.findAllByRole("region", { name: /Live|Repaired/ });
    expect(panes.map((p) => within(p).getByRole("heading").textContent)).toEqual(["Live", "Repaired"]);
    expect(within(panes[0]).getByText("Not judged: the human's own take")).toBeTruthy();
    expect(within(panes[1]).getByText(/Physics: verified/)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId("twin")).toHaveLength(2));
    expect(screen.getAllByRole("img", { name: /Isaac Sim front camera/ }).length).toBeGreaterThanOrEqual(2);
  });

  it("says what the repair changed, with the numbers", async () => {
    page();
    expect(await screen.findByText("Trimmed to 0.76–7.68 s (idle start and end cut)")).toBeTruthy();
    const row = screen.getByRole("row", { name: /Duration/ });
    expect(within(row).getByText("8.34 s")).toBeTruthy();
    expect(within(row).getByText("6.92 s")).toBeTruthy();
    expect(within(row).getByText("−1.42 s")).toBeTruthy();
  });

  // Flaky in the full suite under load (about 1 run in 3, polish 2026-10-27): the page's fetches and the click's
  // episode load can take longer than findBy*'s default 1 s when many files run at once. Same checks, more time.
  it("shows the variants with their badges, and one in the right view on a click", async () => {
    const slow = { timeout: 8000 };
    page();
    expect(await screen.findByText("Multiplied variants: 1 of 2 verified", undefined, slow)).toBeTruthy();
    expect(await screen.findByText("Physics: failed (dropped the cube)", undefined, slow)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Show Variant 3101 in the right view" }, slow));
    expect(await screen.findByRole("heading", { name: "Variant 3101" }, slow)).toBeTruthy();
  }, 20000);

  it("features tonight's experiments and keeps the others behind Show all", async () => {
    const f = vi.fn(async (url: string) => {
      const path = new URL(url, "http://x").pathname;
      if (path === "/showcase/sets") return new Response(JSON.stringify([...SETS, { ...SETS[0], name: "human10a" }]));
      return backend()(url);
    }) as unknown as typeof fetch;
    page("/data", f);
    const nav = await screen.findByRole("navigation", { name: "Experiments" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["mouse20261020mouse", "human10cwebcam", "Show all 3 experiments"]);
    fireEvent.click(within(nav).getByRole("button", { name: "Show all 3 experiments" }));
    expect(within(nav).getAllByRole("button")).toHaveLength(3);
    expect(within(nav).getByRole("button", { name: /human10a/ })).toBeTruthy();
  });

  it("switches experiments", async () => {
    const f = backend();
    page("/data", f);
    fireEvent.click(await screen.findByRole("button", { name: /human10c/ }));
    expect(await screen.findByText(/policy trained on them: 3\/40 unseen scenes/)).toBeTruthy();
  });

  it("watches a running experiment live: stages light up and variants pop in", async () => {
    page("/data?mode=live&set=mouse20261020");
    await waitFor(() => expect(FakeSource.all).toHaveLength(1));
    const es = FakeSource.all[0];
    expect(es.url).toMatch(/\/showcase\/live\/mouse20261020$/);
    act(() => {
      es.onopen?.();
      es.emit({ type: "hello", name: "mouse20261020", ids: ["human_20261020183738_00ab"], input: "mouse", variants: 2 });
      es.emit({ type: "physics", at: "15:05:23", id: "human_20261020183738_00ab", success: true, reasons: [] });
      es.emit({ type: "repair", at: "15:07:14", id: "human_20261020183738_00ab", status: "perfected", repairs: 2 });
      es.emit({ type: "variant", id: "human_20261020183738_00ab_rules_home_m3100", source: "human_20261020183738_00ab", seed: 3100, success: true, reasons: [], frames: 404 });
    });
    const stages = screen.getByRole("list", { name: "SANT's pipeline" });
    const status = (label: string) => within(stages).getByText(label).closest("li")!.getAttribute("data-status");
    expect([status("Physics check"), status("Repair"), status("Multiply"), status("Train")]).toEqual(["done", "done", "running", "waiting"]);
    expect(screen.getByText("Repaired (2)")).toBeTruthy();
    expect(screen.getByText("Variants as they're verified: 1 of 1")).toBeTruthy();
    expect(screen.getByText(/variant 3100/)).toBeTruthy();
    act(() => es.emit({ type: "end" }));
    expect(es.closed).toBe(true);
  });
});
