// The site's routes after the revamp: the journey is the front door, the old room and landing pages
// redirect to it, and the work pages sit in the work shell with the pipeline nav.
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

describe("App routes", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    // No backend in tests: every request fails, and the pages say so.
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens the journey at /", async () => {
    at("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Show a robot once. Get the data to teach it." }, { timeout: 8000 })).toBeTruthy();
  });

  it.each(["/home", "/inventory", "/chat", "/site", "/enter", "/room?room_id=1"])("sends the old page %s to the journey", async (path) => {
    at(path);
    expect(await screen.findByRole("heading", { level: 1, name: "Show a robot once. Get the data to teach it." }, { timeout: 8000 })).toBeTruthy();
  });

  it("frames a work page with the pipeline and the way back to the workshop", async () => {
    at("/pm/results");
    const nav = await screen.findByRole("navigation", { name: "Pipeline" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["01 Record", "02 Review", "03 Dataset", "04 Results"]);
    expect(within(nav).getByRole("link", { name: "04 Results" }).className).toContain("active");
    expect(screen.getByRole("link", { name: "← Workshop" }).getAttribute("href")).toBe("/");
  });
});
