import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant/motion/MotionProvider";
import { FlowPage } from "./FlowPage";
import { FALLBACK, type Flow } from "./model";

function live(over: Partial<Flow> = {}): Flow {
  const body: Flow = JSON.parse(JSON.stringify(FALLBACK));
  body.stages = body.stages.map((s) => (s.id === "analyse" ? { ...s, metric: { ...s.metric, headline: "18 failures read: 17 drops (live)" } } : s));
  return { ...body, ...over };
}

function api(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function page(fetchImpl: typeof fetch) {
  render(
    <MotionProvider>
      <MemoryRouter initialEntries={["/flow"]}>
        <FlowPage fetchImpl={fetchImpl} />
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

describe("FlowPage", () => {
  it("asks GET /flow and shows every stage with its live metric and link", async () => {
    const f = api(live());
    page(f);
    expect(await screen.findByText("18 failures read: 17 drops (live)")).toBeTruthy();
    expect(new URL(f.mock.calls[0][0] as string).pathname).toBe("/flow");
    const list = screen.getByRole("list", { name: /pipeline/i });
    const items = within(list).getAllByRole("listitem").filter((li) => li.hasAttribute("data-stage"));
    expect(items.map((li) => li.getAttribute("data-stage"))).toEqual(FALLBACK.stages.map((s) => s.id));
    const analyse = items.find((li) => li.getAttribute("data-stage") === "analyse")!;
    expect(within(analyse).getByRole("link", { name: /see it on/i }).getAttribute("href")).toBe("/analysis");
    expect(screen.queryByText(/backend isn.t reachable/i)).toBeNull();
  });

  it("marks the stages inside the loop and the way back to Multiply", async () => {
    page(api(live()));
    await screen.findByText("18 failures read: 17 drops (live)");
    const cycle = screen.getByRole("group", { name: /the loop/i });
    const ids = within(cycle).getAllByRole("listitem").filter((li) => li.hasAttribute("data-stage")).map((li) => li.getAttribute("data-stage"));
    expect(ids[0]).toBe("multiply");
    expect(ids[ids.length - 1]).toBe("recipe");
    expect(screen.getByText(/back to multiply/i)).toBeTruthy();
  });

  it("shows a running loop's status", async () => {
    const stages = ["diagnose", "freeze", "train_recipe", "train_control", "eval_recipe", "eval_control", "compare"].map((id, i) => ({
      id,
      status: i < 2 ? "done" : i === 2 ? "running" : "pending",
      started: null,
      ended: null,
    }));
    page(api(live({ loop: { status: "running", name: "loop1", current: "train_recipe", stages, seeds: [5680, 5719], result: null } as Flow["loop"] })));
    expect(await screen.findByText(/training the recipe arm/i)).toBeTruthy();
    const status = screen.getByRole("list", { name: /loop stages/i });
    expect(within(status).getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText(/5680–5719/)).toBeTruthy();
  });

  it("falls back to the committed numbers when the backend is unreachable", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    page(f);
    expect(await screen.findByText(/backend isn.t reachable/i)).toBeTruthy();
    expect(screen.getAllByText("v1 15/40 → v2 30/40").length).toBeGreaterThan(0);
  });

  it("falls back on a malformed body", async () => {
    page(api({ stages: "nope" }));
    expect(await screen.findByText(/backend isn.t reachable/i)).toBeTruthy();
  });
});
