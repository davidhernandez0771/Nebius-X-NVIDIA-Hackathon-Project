// Page states (plan sprint 3, Review Focus 5): an empty store or a backend
// that is down shows a clear message, never a blank screen.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import DatasetPage from "./DatasetPage";
import { demo, down, renderAt, stubBackend } from "../testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Dataset page", () => {
  it("says the backend is unreachable and offers a retry", async () => {
    stubBackend({ "GET /demos": down });
    renderAt("/pm/dataset", <DatasetPage />, "/pm/dataset");
    expect(await screen.findByText(/can't reach the backend/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("invites a first recording when the store is empty", async () => {
    stubBackend({ "GET /demos": { status: 200, body: [] } });
    renderAt("/pm/dataset", <DatasetPage />, "/pm/dataset");
    expect(await screen.findByText("No demos yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Record a demo" }).getAttribute("href")).toBe("/pm/record");
  });

  it("counts demos by source", async () => {
    stubBackend({ "GET /demos": { status: 200, body: [demo("h1", "human"), demo("h2", "human"), demo("r1", "repaired")] } });
    renderAt("/pm/dataset", <DatasetPage />, "/pm/dataset");
    const human = await screen.findByTestId("count-human");
    expect(human.textContent).toBe("2");
    expect(screen.getByTestId("count-repaired").textContent).toBe("1");
    expect(screen.getByTestId("count-variant").textContent).toBe("0");
  });

  it("explains a missing export route instead of failing silently", async () => {
    stubBackend({ "GET /demos": { status: 200, body: [demo("h1", "human")] } });
    renderAt("/pm/dataset", <DatasetPage />, "/pm/dataset");
    fireEvent.click(await screen.findByRole("button", { name: "Export to LeRobot" }));
    expect(await screen.findByText(/export isn't on this backend yet/i)).toBeTruthy();
  });
});
