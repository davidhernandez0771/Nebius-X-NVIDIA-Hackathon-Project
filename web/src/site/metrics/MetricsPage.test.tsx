import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import type { Analysis, Sources } from "../analysis/model";
import { CLIMB, GOAL, TEACHER } from "../results/proofData";
import { MetricsPage } from "./MetricsPage";
import { PILLARS } from "./model";

// The 3D hall needs WebGL, which jsdom lacks; it stands in as a marker that shows how the page drives it.
vi.mock("./HallScene", () => ({
  default: (p: { animate: boolean; selected: number | null }) => <div data-testid="hall" data-animate={String(p.animate)} />,
}));

const SOURCES: Sources = {
  live_enabled: false,
  sources: [
    { id: "bigtest_final", title: "Final", detail: "", episodes: 69, successes: 51, post_hoc: true, cached: true },
    { id: "stage_a_60k", title: "Stage A · 60k steps", detail: "", episodes: 29, successes: 13, post_hoc: false, cached: false },
    { id: "stage_a_120k", title: "Stage A · 120k steps", detail: "", episodes: 29, successes: 17, post_hoc: false, cached: false },
  ],
};

const pt = (seed: number, success: boolean, test: boolean) => ({ seed, success, primary: success ? null : "dropped", reasons: [], cube: [0.5, 0] as [number, number], bin: [0.5, 0.2] as [number, number], cube_yaw_deg: 0, test });

const FINAL: Analysis = {
  id: "bigtest_final",
  title: "Final",
  detail: "The big test's final model (Stage A, 180k steps): its selection on 5500-5528",
  episodes: 69,
  successes: 51,
  failures: 18,
  post_hoc: true,
  untraced: true,
  failure_counts: {},
  failure_table: [],
  points: [...Array.from({ length: 40 }, (_, i) => pt(5400 + i, i < 30, true)), ...Array.from({ length: 29 }, (_, i) => pt(5500 + i, i < 21, false))],
  rules: null,
  nemotron: {
    recipe: { summary: "s", regions: [{ name: "left_cube_right_bin", targets: ["dropped"], cube_x: [0, 1], cube_y: [0, 1], cube_yaw_deg: [0, 1], bin_x: [0, 1], bin_y: [0, 1], share: 0.4, rationale: "r" }], uniform_share: 0.6, fixes: [] },
    support: [{ region: "left_cube_right_bin", episodes_inside: 29, target_failures_inside: 10, target_failures_total: 17, coverage: 0.59, rate_inside: 0.34, rate_overall: 0.25, p_value: 0.0918 }],
    agreement: 0.83,
    candidates: 3,
    k: 3,
    calls: 5,
    cost_usd: 0.042488,
    model: "nvidia/nemotron-3-super-120b-a12b",
    api_errors: 0,
    attempts: [
      { sample: 0, think: true, accepted: false, errors: ["likely chance"], claimed: null, excerpt: "{" },
      { sample: 0, think: true, accepted: true, errors: [], claimed: null, excerpt: null },
      { sample: 1, think: true, accepted: true, errors: [], claimed: null, excerpt: null },
      { sample: 2, think: true, accepted: true, errors: [], claimed: null, excerpt: null },
    ],
  },
  live_enabled: false,
};

function backend(up = true) {
  return vi.fn(async (url: string) => {
    if (!up) throw new TypeError("Failed to fetch");
    const path = new URL(url).pathname;
    const body = path === "/analysis/sources" ? SOURCES : path === "/analysis/bigtest_final" ? FINAL : null;
    return new Response(JSON.stringify(body ?? { detail: "Not Found" }), { status: body ? 200 : 404 });
  }) as unknown as typeof fetch;
}

let media: { reduce: boolean; phone: boolean };

function page(opts: { webgl?: boolean; fetchImpl?: typeof fetch } = {}) {
  render(
    <MotionProvider>
      <MemoryRouter initialEntries={["/metrics"]}>
        <MetricsPage fetchImpl={opts.fetchImpl ?? backend()} webgl={opts.webgl} />
      </MemoryRouter>
    </MotionProvider>,
  );
}

beforeEach(() => {
  media = { reduce: false, phone: false };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({ matches: q.includes("reduce") ? media.reduce : q.includes("max-width") ? media.phone : false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the metrics page", () => {
  it("leads with v2's one-shot result: count, rate, Wilson interval, seeds, run once", async () => {
    page({ webgl: false });
    const hero = await screen.findByRole("region", { name: /headline/i });
    expect(within(hero).getByText(`${CLIMB[3].k}/${CLIMB[3].n}`)).toBeTruthy();
    expect(hero.textContent).toContain("75%");
    expect(hero.textContent).toContain("Wilson 95% CI 0.60–0.86");
    expect(hero.textContent).toContain("seeds 5400–5439");
    expect(hero.textContent).toMatch(/run once/i);
    expect(hero.textContent).toContain(`${GOAL.k}/${GOAL.n}`);
  });

  it("tables every pillar with its count, rate, interval and seeds, exactly as the data modules have them", async () => {
    page({ webgl: false });
    const table = await screen.findByRole("table", { name: /success on unseen scenes/i });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(PILLARS.length);
    PILLARS.forEach((p, i) => {
      const cells = within(rows[i]).getAllByRole("cell").map((c) => c.textContent);
      expect(cells).toEqual([`${p.k}/${p.n}`, `${Math.round((100 * p.k) / p.n)}%`, `${p.ci[0].toFixed(2)}–${p.ci[1].toFixed(2)}`, p.seeds]);
    });
  });

  it("draws the goal line at 60% and says only v2 crosses it", async () => {
    page({ webgl: false });
    const climb = await screen.findByRole("img", { name: /the climb/i });
    expect(climb.getAttribute("aria-label")).toMatch(/goal of 24\/40 \(60%\)/);
    expect(within(climb).getByText(/Goal 60%/)).toBeTruthy();
  });

  it("shows the teacher with and without demo starts", async () => {
    page({ webgl: false });
    const t = await screen.findByRole("img", { name: /RL teacher/i });
    const last = TEACHER.final;
    expect(t.getAttribute("aria-label")).toContain(`${last.withDemos.k}/${last.withDemos.n}`);
    expect(t.getAttribute("aria-label")).toContain(`${last.withoutDemos.k}/${last.withoutDemos.n}`);
  });

  it("reads Stage A's selection from the backend, with the best-of-3 caveat", async () => {
    page({ webgl: false });
    const sel = await screen.findByRole("region", { name: /checkpoint selection/i });
    expect(await within(sel).findByText("21/29")).toBeTruthy();
    expect(within(sel).getByText("13/29")).toBeTruthy();
    expect(within(sel).getByText("17/29")).toBeTruthy();
    expect(sel.textContent).toMatch(/best-of-3/);
  });

  it("lists what this does not show", async () => {
    page({ webgl: false });
    const list = await screen.findByRole("region", { name: /does not show/i });
    expect(list.textContent).toMatch(/no ablation/);
    expect(list.textContent).toMatch(/one training seed/);
    expect(list.textContent).toMatch(/fresh seeds 5400–5439/);
  });

  it("shows Nemotron's run on the final model", async () => {
    page({ webgl: false });
    const strip = await screen.findByRole("region", { name: /nemotron/i });
    expect(await within(strip).findByText("69")).toBeTruthy();
    expect(strip.textContent).toMatch(/3\s*kept/);
    expect(strip.textContent).toMatch(/1\s*sent back/);
    expect(strip.textContent).toContain("$0.042");
    expect(strip.textContent).toContain("nvidia/nemotron-3-super-120b-a12b");
    expect(strip.textContent).toContain("weak lead, one-sided p = 0.09");
  });

  it("stays whole when the backend is unreachable: a quiet line and a link to /analysis", async () => {
    page({ webgl: false, fetchImpl: backend(false) });
    const strip = await screen.findByRole("region", { name: /nemotron/i });
    expect(await within(strip).findByText(/couldn't reach the analyst/i)).toBeTruthy();
    expect(within(strip).getByRole("link", { name: /analyst page/i }).getAttribute("href")).toBe("/analysis");
    const sel = screen.getByRole("region", { name: /checkpoint selection/i });
    expect(await within(sel).findByText(/couldn't reach/i)).toBeTruthy();
    expect(screen.getAllByText("30/40").length).toBeGreaterThan(0);
  });
});

describe("the 3D hall and its fallbacks", () => {
  it("without WebGL shows the 2D charts only, with a one-line note", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    page();
    expect(await screen.findByText(/no WebGL/i)).toBeTruthy();
    expect(screen.queryByTestId("hall")).toBeNull();
    expect(screen.getByRole("img", { name: /the climb/i })).toBeTruthy();
  });

  it("with WebGL shows the hall, moving", async () => {
    page({ webgl: true });
    expect((await screen.findByTestId("hall")).dataset.animate).toBe("true");
  });

  it("with reduced motion shows the hall still, and the charts drawn at once", async () => {
    media.reduce = true;
    page({ webgl: true });
    expect((await screen.findByTestId("hall")).dataset.animate).toBe("false");
    expect(document.querySelector(".mx")?.getAttribute("data-motion")).toBe("still");
  });

  it("on a phone replaces the hall with the 2D climb", async () => {
    media.phone = true;
    page({ webgl: true });
    expect(await screen.findByRole("img", { name: /the climb/i })).toBeTruthy();
    expect(screen.queryByTestId("hall")).toBeNull();
  });

  it("lets a keyboard pick a pillar and reads out its count, interval and seeds", async () => {
    page({ webgl: true });
    const picker = await screen.findByRole("group", { name: /pillars/i });
    const v2 = within(picker).getByRole("button", { name: /v2/ });
    v2.focus();
    const out = screen.getByRole("status", { name: /selected pillar/i });
    expect(out.textContent).toContain("30/40 (75%), Wilson 95% CI 0.60–0.86, seeds 5400–5439");
  });
});
