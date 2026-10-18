import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { MotionProvider } from "../motion/MotionProvider";
import { powerOnPlan } from "../motion/powerOn";
import { DURATIONS } from "../motion/tokens";
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

// The test's own pages: /story is paper, /app is volt.
const testModes = (p: string) => (p === "/story" ? "paper" : p === "/app" ? "volt" : null);

function app(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MotionProvider>
        <ToastProvider>
          <PowerOnProvider modeOf={testModes}>
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
    // Content spec §3, "Footer (story pages)".
    expect(screen.getByRole("contentinfo").textContent).toMatch(/Built with NVIDIA Isaac Lab, NVIDIA Nemotron and Nebius Token Factory/);
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
  // jsdom has no 2D canvas; say so up front instead of letting it log "not implemented".
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the dust on a canvas that assistive tech never sees", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    app("/story");
    fireEvent.click(screen.getByRole("button", { name: "Open the app" }));
    const canvas = document.querySelector(".sant-poweron canvas");
    expect(canvas).toBeTruthy();
    expect(canvas?.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it("lights each unit of the mark as its dust lands", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    app("/story");
    fireEvent.click(screen.getByRole("button", { name: "Open the app" }));
    const lit = () => Array.from(document.querySelectorAll(".sant-poweron__unit")).map((u) => u.getAttribute("data-lit"));
    const gather = powerOnPlan(false).find((p) => p.phase === "gather");
    if (gather?.phase !== "gather") throw new Error("no gather step");
    act(() => {
      vi.advanceTimersByTime(gather.at + gather.duration - 1);
    });
    expect(lit()).toEqual(["false", "false", "false", "false"]);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(lit()).toEqual(["true", "false", "false", "false"]);
    act(() => {
      vi.advanceTimersByTime(3 * gather.stagger);
    });
    expect(lit()).toEqual(["true", "true", "true", "true"]);
  });

  it("still lights the mark, without dust, where there is no 2D canvas", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    app("/story");
    fireEvent.click(screen.getByRole("button", { name: "Open the app" }));
    expect(document.querySelector(".sant-poweron")?.getAttribute("data-dust")).toBe("off");
  });

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
      vi.advanceTimersByTime(DURATIONS.power - 420 + 20);
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

// Story ↔ app crossings between plain links, in both directions, and ones the provider didn't start.
function CodeBack() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/story")}>
      Back by code
    </button>
  );
}

function site(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MotionProvider>
        <ToastProvider>
          <PowerOnProvider modeOf={testModes}>
            <Routes>
              <Route
                path="/story"
                element={
                  <StoryShell>
                    <h1>Story page</h1>
                    <Link to="/app">Go to the app</Link>
                    <Link to="/other">Another page</Link>
                  </StoryShell>
                }
              />
              <Route
                path="/app"
                element={
                  <AppShell title="App page" active={1}>
                    <Link to="/story">Back to the story</Link>
                    <CodeBack />
                  </AppShell>
                }
              />
              <Route path="/other" element={<h1>Other page</h1>} />
            </Routes>
          </PowerOnProvider>
        </ToastProvider>
      </MotionProvider>
    </MemoryRouter>,
  );
}

describe("the story ↔ app crossing on links", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const navigateAt = () => {
    const step = powerOnPlan(false).find((s) => s.phase === "navigate");
    if (!step) throw new Error("no navigate step");
    return step.at;
  };

  it("plays on a plain link from a story page to an app page, in the app's colours", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    site("/story");
    fireEvent.click(screen.getByRole("link", { name: "Go to the app" }));
    const overlay = document.querySelector(".sant-poweron");
    expect(overlay?.getAttribute("data-mode")).toBe("volt");
    expect(screen.getByRole("heading", { name: "Story page" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(navigateAt());
    });
    expect(screen.getByRole("heading", { name: "App page" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(DURATIONS.power);
    });
    expect(document.querySelector(".sant-poweron")).toBeNull();
  });

  it("plays in reverse on a link from an app page back to the story, in the story's colours", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    site("/app");
    fireEvent.click(screen.getByRole("link", { name: "Back to the story" }));
    expect(document.querySelector(".sant-poweron")?.getAttribute("data-mode")).toBe("paper");
    act(() => {
      vi.advanceTimersByTime(DURATIONS.power + 20);
    });
    expect(screen.getByRole("heading", { name: "Story page" })).toBeTruthy();
    expect(document.querySelector(".sant-poweron")).toBeNull();
  });

  it("leaves links that don't cross alone", () => {
    stubReducedMotion(false);
    site("/story");
    fireEvent.click(screen.getByRole("link", { name: "Another page" }));
    expect(document.querySelector(".sant-poweron")).toBeNull();
    expect(screen.getByRole("heading", { name: "Other page" })).toBeTruthy();
  });

  it("covers a crossing it didn't start (back button, code) with the second half", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    site("/app");
    fireEvent.click(screen.getByRole("button", { name: "Back by code" }));
    expect(screen.getByRole("heading", { name: "Story page" })).toBeTruthy();
    expect(document.querySelector(".sant-poweron")?.getAttribute("data-mode")).toBe("paper");
    act(() => {
      vi.advanceTimersByTime(DURATIONS.power);
    });
    expect(document.querySelector(".sant-poweron")).toBeNull();
  });

  it("is a quick crossfade when motion is reduced: the route changes at once under a fading cover", () => {
    stubReducedMotion(true);
    site("/story");
    fireEvent.click(screen.getByRole("link", { name: "Go to the app" }));
    expect(screen.getByRole("heading", { name: "App page" })).toBeTruthy();
    expect(document.querySelector(".sant-poweron")).toBeNull();
    expect(document.querySelector(".sant-crossfade")?.getAttribute("data-mode")).toBe("volt");
  });

  it("uses a view transition for the crossfade where the browser has one", () => {
    stubReducedMotion(true);
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    vi.stubGlobal("document", Object.assign(document, { startViewTransition }));
    site("/story");
    fireEvent.click(screen.getByRole("link", { name: "Go to the app" }));
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "App page" })).toBeTruthy();
    expect(document.querySelector(".sant-crossfade")).toBeNull();
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });
});
