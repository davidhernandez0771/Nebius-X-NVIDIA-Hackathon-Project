import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
