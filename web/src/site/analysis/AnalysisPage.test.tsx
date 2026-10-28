import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import AnalysisPage from "./AnalysisPage";
import { extent, outcomeOf, ticks, verdictText, type Analysis, type Nemotron } from "./model";

const REGION = {
  name: "left_cube_right_bin",
  targets: ["dropped"],
  cube_x: [0.4, 0.6] as [number, number],
  cube_y: [0.07, 0.2] as [number, number],
  cube_yaw_deg: [-45, 45] as [number, number],
  bin_x: [0.4, 0.65] as [number, number],
  bin_y: [-0.3, -0.1] as [number, number],
  share: 0.4,
  rationale: "r",
};

const NEMOTRON: Nemotron = {
  recipe: { summary: "drops on cross-body carries", regions: [REGION], uniform_share: 0.6, fixes: [] },
  support: [{ region: "left_cube_right_bin", episodes_inside: 29, target_failures_inside: 10, target_failures_total: 17, coverage: 0.59, rate_inside: 0.34, rate_overall: 0.25, p_value: 0.0918 }],
  agreement: 0.83,
  candidates: 3,
  k: 3,
  calls: 5,
  cost_usd: 0.0425,
  model: "nvidia/nemotron-3-super-120b-a12b",
  api_errors: 0,
  attempts: [
    { sample: 0, think: true, accepted: false, errors: ["region 'left_cube_right_bin': likely chance (one-sided Fisher p = 0.175 > 0.1)"], claimed: { summary: "drops left of centre", regions: ["left_cube_right_bin"], fixes: [], mechanism: [] }, excerpt: "{" },
    { sample: 0, think: true, accepted: true, errors: [], claimed: { summary: "no clear pattern", regions: [], fixes: [], mechanism: [] }, excerpt: null },
    { sample: 1, think: true, accepted: false, errors: ["the model service did not answer"], claimed: null, excerpt: null },
  ],
};

const table = ["cube_x", "cube_y", "bin_x", "bin_y"].map((axis) => ({ axis, bin: (axis.endsWith("x") ? [0.4, 0.6] : [-0.3, 0.3]) as [number, number], n: 3, successes: 2, failures: { dropped: 1 } }));

function analysis(over: Partial<Analysis> = {}): Analysis {
  return {
    id: "bigtest_final",
    title: "Final model · selection + test",
    detail: "The big test's final model.",
    episodes: 3,
    successes: 2,
    failures: 1,
    post_hoc: true,
    untraced: true,
    failure_counts: { dropped: 1 },
    failure_table: table,
    points: [
      { seed: 5400, success: false, primary: "dropped", reasons: ["not_in_bin", "dropped"], cube: [0.5, 0.1], bin: [0.5, -0.2], cube_yaw_deg: 0, test: true },
      { seed: 5401, success: true, primary: null, reasons: [], cube: [0.45, -0.1], bin: [0.55, 0.2], cube_yaw_deg: 10, test: true },
      { seed: 5500, success: true, primary: null, reasons: [], cube: [0.55, 0.0], bin: [0.6, 0.1], cube_yaw_deg: -5, test: false },
    ],
    rules: null,
    nemotron: NEMOTRON,
    live_enabled: false,
    ...over,
  };
}

const SOURCES = {
  live_enabled: false,
  sources: [
    { id: "bigtest_final", title: "Final model · selection + test", detail: "", episodes: 69, successes: 51, post_hoc: true, cached: true },
    { id: "stage_a_60k", title: "Stage A · 60k steps", detail: "", episodes: 29, successes: 13, post_hoc: false, cached: false },
  ],
};

function api(body: (path: string, init?: RequestInit) => unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const out = body(path, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out ?? { detail: "Not Found" }), { status: out ? 200 : 404 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function page(fetchImpl: typeof fetch, url = "/analysis") {
  render(
    <MotionProvider>
      <MemoryRouter initialEntries={[url]}>
        <AnalysisPage fetchImpl={fetchImpl} />
      </MemoryRouter>
    </MotionProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the failure analyst page", () => {
  it("shows the outcome, Nemotron's verdict and the claims the code sent back", async () => {
    page(api((p) => (p === "/analysis/sources" ? SOURCES : p === "/analysis/bigtest_final" ? analysis() : null)));
    expect(await screen.findByRole("heading", { level: 1, name: "Failure analyst" })).toBeTruthy();
    expect(await screen.findByText("2/3")).toBeTruthy();
    expect(screen.getByText("more scenes in left cube right bin (weak lead, one-sided p = 0.09)")).toBeTruthy();
    expect(screen.getByText(/Post-hoc\./)).toBeTruthy();
    expect(screen.getByText(/No step traces\./)).toBeTruthy();
    const claims = screen.getAllByRole("table")[0];
    const rows = within(claims).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["sent back", "kept", "no answer"]);
    expect(within(rows[0]).getByText(/likely chance/)).toBeTruthy();
    expect(screen.getByText("p = 0.09")).toBeTruthy();
    expect(screen.getAllByRole("img", { name: /Where the (cube started|bin was): 3 episodes/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Ask Nemotron now" })).toBeNull(); // live runs are off
  });

  it("picks another source from the list", async () => {
    const f = api((p) => (p === "/analysis/sources" ? SOURCES : p === "/analysis/bigtest_final" ? analysis() : p === "/analysis/stage_a_60k" ? analysis({ id: "stage_a_60k", detail: "Stage A at 60k.", post_hoc: false, nemotron: null }) : null));
    page(f);
    fireEvent.click(await screen.findByRole("button", { name: /Stage A · 60k steps/ }));
    expect(await screen.findByText("Stage A at 60k.")).toBeTruthy();
    expect(screen.getByText("Not asked yet")).toBeTruthy();
    expect(screen.queryByText(/Post-hoc\./)).toBeNull();
  });

  it("asks Nemotron live when the server allows it, and says why when it refuses", async () => {
    let posts = 0;
    const f = api((p, init) => {
      if (p === "/analysis/sources") return { ...SOURCES, live_enabled: true };
      if (p === "/analysis/bigtest_final/run" && init?.method === "POST") {
        posts += 1;
        return posts === 1
          ? analysis({ live_enabled: true, nemotron: { ...NEMOTRON, recipe: { summary: "s", regions: [], uniform_share: 1 }, calls: 4 } })
          : new Response(JSON.stringify({ detail: "one live run a minute; try again in 42 s" }), { status: 429 });
      }
      if (p === "/analysis/bigtest_final") return analysis({ live_enabled: true });
      return null;
    });
    page(f);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Nemotron now" }));
    expect(await screen.findByText("Keep the data as it is")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask Nemotron now" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "one live run a minute; try again in 42 s");
  });

  it("refuses an id that isn't a name before asking the server", async () => {
    const f = api((p) => (p === "/analysis/sources" ? SOURCES : null));
    page(f, "/analysis?source=..%2F..%2Fetc");
    expect(await screen.findByText(/not an analysis id/)).toBeTruthy();
    await waitFor(() => expect(f.mock.calls.every(([u]) => !String(u).includes(".."))).toBe(true));
  });
});

describe("the model", () => {
  it("classes outcomes, reads extents, ticks cleanly and words the verdict", () => {
    expect(outcomeOf({ success: false, primary: "collision_bin" })).toBe("collision");
    expect(outcomeOf({ success: false, primary: "stuck" })).toBe("other");
    expect(extent(table, "cube_y")).toEqual([-0.3, 0.3]);
    expect(ticks([0.37, 0.68])).toEqual([0.4, 0.5, 0.6]);
    expect(verdictText(null)).toBe("Not asked yet");
    expect(verdictText({ ...NEMOTRON, recipe: null, api_errors: 3 })).toBe("The model service did not answer");
  });
});
