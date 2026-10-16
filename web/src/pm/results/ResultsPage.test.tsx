// Page states (plan sprint 3, Review Focus 5): an empty store or a backend
// that is down shows a clear message, never a blank screen.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import ResultsPage from "./ResultsPage";
import { renderAt } from "../testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Results page", () => {
  it("labels everything as sample data", () => {
    renderAt("/pm/results", <ResultsPage />, "/pm/results");
    expect(screen.getByText("SAMPLE DATA — experiments pending")).toBeTruthy();
  });
});

describe("Results page sample marking", () => {
  it("marks every figure as sample, not measured", () => {
    renderAt("/pm/results", <ResultsPage />, "/pm/results");
    expect(screen.getAllByText(/sample/i).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(/measured result/i)).toBeNull();
  });

  it("refuses to draw a file that fails validation", () => {
    renderAt("/pm/results", <ResultsPage data={{ demos: [5], series: [{ key: "raw", label: "Raw", success: [3] }] }} />, "/pm/results");
    expect(screen.getByText(/can't show these results/i)).toBeTruthy();
  });
});
