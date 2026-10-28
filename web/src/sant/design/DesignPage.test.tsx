import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DURATIONS } from "../motion/tokens";
import { SantRoot } from "../SantRoot";
import { DesignAppPage } from "./DesignAppPage";
import { DesignPage } from "./DesignPage";

vi.mock("lenis", () => ({ default: class { destroy() {} } }));

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<SantRoot />}>
          <Route path="/design" element={<DesignPage />} />
          <Route path="/design/app" element={<DesignAppPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe("/design", () => {
  it("is a story page in paper mode with a volt specimen beside it", () => {
    const { container } = at("/design");
    expect(container.querySelector('.sant-shell[data-mode="paper"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-mode="volt"]').length).toBeGreaterThan(0);
  });

  it("has a section for every part of the system", () => {
    at("/design");
    for (const name of ["Colour", "Type", "Space and radius", "Motion", "Components", "Shells"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    }
  });

  it("shows the real result with its source, not sample numbers", () => {
    at("/design");
    const figure = screen.getByRole("figure", { name: /40 new scenes/ });
    const table = within(figure).getByRole("table");
    expect(within(table).getByText("3 of 40")).toBeTruthy();
    expect(within(table).getByText("17 of 40")).toBeTruthy();
    expect(within(figure).getByText("Fisher exact p = 0.0005")).toBeTruthy();
    expect(within(figure).getByText(/T3 status note/)).toBeTruthy();
  });

  it("lists the motion tokens", () => {
    at("/design");
    const motion = screen.getByRole("region", { name: "Motion" });
    for (const token of ["--sant-dur-1", "--sant-dur-power", "--sant-ease-out", "--sant-stagger-sant"]) {
      expect(within(motion).getByText(token)).toBeTruthy();
    }
  });

  it("shows each app-page part in its own section, drawn in Volt", () => {
    at("/design");
    for (const name of ["Tracking HUD", "Status glyphs", "Count-up tiles", "Countdown", "Dials", "Glyph loader", "Pill nav"]) {
      const region = screen.getByRole("region", { name });
      expect(region.querySelector('[data-mode="volt"]')).toBeTruthy();
    }
  });

  it("counts the real result up on tiles, with its source", () => {
    at("/design");
    const region = screen.getByRole("region", { name: "Count-up tiles" });
    expect(within(region).getAllByRole("group", { name: "42.5% success on 40 new scenes" }).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(/T3 status note/).length).toBeGreaterThan(0);
  });

  it("walks one demo through the pipeline glyphs", () => {
    vi.useFakeTimers();
    at("/design");
    const region = screen.getByRole("region", { name: "Status glyphs" });
    fireEvent.click(within(region).getByRole("button", { name: "Run a demo through" }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    const strip = within(region).getByRole("list", { name: "One demo through the pipeline" });
    expect(within(strip).getAllByRole("img", { name: "Verified" })).toHaveLength(1);
  });

  it("runs the 3-2-1 countdown from its button", () => {
    vi.useFakeTimers();
    at("/design");
    const region = screen.getByRole("region", { name: "Countdown" });
    fireEvent.click(within(region).getByRole("button", { name: "Start the countdown" }));
    expect(within(region).getByRole("timer").textContent).toMatch(/Recording starts in 3/);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(within(region).getByText("Recording would start now.")).toBeTruthy();
  });

  it("goes to the app shell from the pill nav, through the story → app crossing", () => {
    // jsdom has no 2D canvas; the crossing falls back to its plain cover.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.useFakeTimers();
    at("/design");
    const region = screen.getByRole("region", { name: "Pill nav" });
    fireEvent.click(within(region).getByRole("link", { name: "App shell" }));
    expect(document.querySelector(".sant-poweron")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(DURATIONS.power + 20);
    });
    expect(screen.getByRole("heading", { level: 1, name: /Review/ })).toBeTruthy();
    expect(document.querySelector(".sant-poweron")).toBeNull();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("offers a visible effects switch", () => {
    at("/design");
    expect(screen.getAllByRole("switch", { name: /effects/i }).length).toBeGreaterThan(0);
  });

  it("opens the app shell through the power-on (instant with reduced motion)", () => {
    stubReducedMotion(true);
    at("/design");
    fireEvent.click(screen.getByRole("button", { name: "Open the app shell" }));
    expect(screen.getByRole("heading", { level: 1, name: /Review/ })).toBeTruthy();
  });

  it("shows a toast from the toast specimen", () => {
    at("/design");
    fireEvent.click(screen.getByRole("button", { name: "Show a saved toast" }));
    expect(screen.getByRole("status").textContent).toMatch(/Demo saved/);
  });
});

describe("/design/app", () => {
  it("is the volt app shell, marked as sample data, with a way back", () => {
    const { container } = at("/design/app");
    expect(container.querySelector('.sant-shell[data-mode="volt"]')).toBeTruthy();
    expect(screen.getByText("Sample layout")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the design page" }));
    expect(screen.getByRole("heading", { level: 2, name: "Colour" })).toBeTruthy();
  });
});
