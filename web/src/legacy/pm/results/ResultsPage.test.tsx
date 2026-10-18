// Results page (plan sprint 3b, T5 Task 2): real results from GET /results when
// there are any, else the sample file under its banner. null means pending, never 0.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import ResultsPage from "./ResultsPage";
import { down, renderAt, stubBackend } from "../testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BANNER = "SAMPLE DATA — experiments pending";

const measured = {
  sample: false,
  demos: [5, 10, 20],
  series: [
    { key: "raw", label: "Raw human demos", success: [0.42, null, null] },
    { key: "raw_multiply", label: "Raw + multiply", success: [null, null, null] },
    { key: "ours", label: "Perfected + multiply", success: [0.61, null, null] },
  ],
  ablation: {
    demos: 10,
    bars: [
      { key: "rules", label: "Rules-only repair", success: null },
      { key: "ours", label: "Rules + Nemotron repair", success: null },
    ],
  },
  multiply_yield: { ours: 0.9, mimicgen: [0.38, 0.74] },
  sources: { "multiply_yield.ours": "yield.json" },
};

describe("Results page with measured results", () => {
  it("shows them without the sample banner or sample tags", async () => {
    stubBackend({ "GET /results": { status: 200, body: measured } });
    renderAt("/legacy/pm/results", <ResultsPage />, "/legacy/pm/results");
    expect(await screen.findByText("Policy success on 50 test positions")).toBeTruthy();
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(screen.queryByText(/\(sample\)/)).toBeNull();
  });

  it("renders null as pending, never as 0%", async () => {
    stubBackend({ "GET /results": { status: 200, body: measured } });
    renderAt("/legacy/pm/results", <ResultsPage />, "/legacy/pm/results");
    await screen.findByText("Policy success on 50 test positions");
    const bars = screen.getAllByTestId("ablation-value").map((e) => e.textContent);
    expect(bars).toEqual(["pending", "pending"]);
    expect(screen.getByTestId("yield-ours").textContent).toBe("90%");
    expect(screen.getByTestId("series-raw_multiply").textContent).toMatch(/pending/);
    expect(screen.getByTestId("series-raw").textContent).toMatch(/42% at 5/);
  });

  it("says yield is pending when it is null", async () => {
    stubBackend({ "GET /results": { status: 200, body: { ...measured, multiply_yield: { ours: null, mimicgen: [0.38, 0.74] } } } });
    renderAt("/legacy/pm/results", <ResultsPage />, "/legacy/pm/results");
    expect((await screen.findByTestId("yield-ours")).textContent).toBe("pending");
  });

  it("keeps the banner when the served file is itself flagged as sample", async () => {
    stubBackend({ "GET /results": { status: 200, body: { ...measured, sample: true } } });
    renderAt("/legacy/pm/results", <ResultsPage />, "/legacy/pm/results");
    expect(await screen.findByText(BANNER)).toBeTruthy();
  });
});

describe("Results page without measured results", () => {
  it("falls back to the sample file, under the banner, when there are no results yet", async () => {
    stubBackend({ "GET /results": { status: 404, body: { detail: "no results yet" } } });
    renderAt("/legacy/pm/results", <ResultsPage />, "/legacy/pm/results");
    expect(await screen.findByText(BANNER)).toBeTruthy();
    expect(screen.getByText(/no measured results yet/i)).toBeTruthy();
    expect(screen.getAllByText(/\(sample\)/).length).toBeGreaterThanOrEqual(3);
  });

  it("falls back to the sample when the backend is down, and says so", async () => {
    stubBackend({ "GET /results": down });
    renderAt("/legacy/pm/results", <ResultsPage />, "/legacy/pm/results");
    expect(await screen.findByText(BANNER)).toBeTruthy();
    expect(screen.getByText(/can't reach the backend/i)).toBeTruthy();
  });

  it("shows why a corrupt results file was rejected, then the sample", async () => {
    stubBackend({ "GET /results": { status: 422, body: { detail: "results.json is corrupt: JSONDecodeError" } } });
    renderAt("/legacy/pm/results", <ResultsPage />, "/legacy/pm/results");
    expect(await screen.findByText(BANNER)).toBeTruthy();
    expect(screen.getByText(/results.json is corrupt/)).toBeTruthy();
  });

  it("refuses a served file that fails validation and shows the sample instead", async () => {
    stubBackend({ "GET /results": { status: 200, body: { ...measured, series: [{ key: "raw", label: "Raw", success: [3, null, null] }] } } });
    renderAt("/legacy/pm/results", <ResultsPage />, "/legacy/pm/results");
    expect(await screen.findByText(BANNER)).toBeTruthy();
    expect(screen.getByText(/can't show the measured results/i)).toBeTruthy();
  });
});
