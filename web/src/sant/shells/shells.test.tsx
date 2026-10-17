import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MotionProvider } from "../motion/MotionProvider";
import { ToastProvider } from "../components";
import { AppShell } from "./AppShell";
import { PowerOnProvider } from "./PowerOn";
import { StoryShell } from "./StoryShell";

const lenis = vi.hoisted(() => ({ created: 0, destroyed: 0 }));
vi.mock("lenis", () => ({
  default: class {
    constructor() {
      lenis.created += 1;
    }
    destroy() {
      lenis.destroyed += 1;
    }
  },
}));

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("reduce"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function app(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MotionProvider>
        <ToastProvider>
          <PowerOnProvider>
            <Routes>
              <Route
                path="/story"
                element={
                  <StoryShell cta={{ label: "Open the app", to: "/app" }}>
                    <h1>Story page</h1>
                  </StoryShell>
                }
              />
              <Route
                path="/app"
                element={
                  <AppShell title="App page" active={1}>
                    <p>stage</p>
                  </AppShell>
                }
              />
            </Routes>
          </PowerOnProvider>
        </ToastProvider>
      </MotionProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  lenis.created = 0;
  lenis.destroyed = 0;
  localStorage.clear();
});

describe("StoryShell", () => {
  it("is the paper mode, with the story nav and the plain-text NVIDIA credit", () => {
    const { container } = app("/story");
    expect(container.querySelector('[data-mode="paper"]')).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Story" })).toBeTruthy();
    expect(screen.getByRole("contentinfo").textContent).toMatch(/NVIDIA Isaac Sim/);
  });

  it("creates Lenis smooth scroll with full motion, and destroys it on leaving", () => {
    stubReducedMotion(false);
    const { unmount } = app("/story");
    expect(lenis.created).toBe(1);
    unmount();
    expect(lenis.destroyed).toBe(1);
  });

  it("does not create Lenis when motion is reduced", () => {
    stubReducedMotion(true);
    app("/story");
    expect(lenis.created).toBe(0);
  });
});

describe("AppShell", () => {
  it("is the volt mode, with the step rail and the effects switch, and no smooth scroll", () => {
    stubReducedMotion(false);
    const { container } = app("/app");
    expect(container.querySelector('[data-mode="volt"]')).toBeTruthy();
    expect(screen.getByRole("list", { name: "SANT steps" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /effects/i })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "App page" })).toBeTruthy();
    expect(lenis.created).toBe(0);
  });
});

describe("PowerOn (story → app)", () => {
  it("covers the page, changes the route while covered, then reveals the app", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    app("/story");
    fireEvent.click(screen.getByRole("button", { name: "Open the app" }));
    expect(document.querySelector(".sant-poweron")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("heading", { name: "Story page" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(420);
    });
    expect(screen.getByRole("heading", { name: "App page" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(document.querySelector(".sant-poweron")).toBeNull();
    expect(document.activeElement?.textContent).toBe("App page");
  });

  it("is an instant route change with no overlay when motion is reduced", () => {
    stubReducedMotion(true);
    app("/story");
    fireEvent.click(screen.getByRole("button", { name: "Open the app" }));
    expect(document.querySelector(".sant-poweron")).toBeNull();
    expect(screen.getByRole("heading", { name: "App page" })).toBeTruthy();
  });

  it("skips to the end on Escape", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    app("/story");
    fireEvent.click(screen.getByRole("button", { name: "Open the app" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".sant-poweron")).toBeNull();
    expect(screen.getByRole("heading", { name: "App page" })).toBeTruthy();
  });
});
