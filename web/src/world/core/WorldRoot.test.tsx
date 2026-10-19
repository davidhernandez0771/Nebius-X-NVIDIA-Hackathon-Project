// The world without WebGL (jsdom has none, and ?static forces it): the overlays, the journey rail,
// the workshop's cartridge choice, the workbench branch and the handoff to a 2D route all work.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant";
import WorldRoot from "./WorldRoot";

function renderWorld() {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={["/world"]}>
        <Routes>
          <Route path="/world" element={<WorldRoot webgl={false} />} />
          <Route path="/pm/record" element={<h1>Record page</h1>} />
          <Route path="/pm/review" element={<h1>Review page</h1>} />
        </Routes>
      </MemoryRouter>
    </MotionProvider>,
  );
}

const current = () => document.querySelector<HTMLElement>('.world-station[data-current="true"]')?.dataset.station;

function scrollTo(y: number) {
  act(() => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    window.dispatchEvent(new Event("scroll"));
  });
}

describe("WorldRoot (no WebGL)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens on the story, with the title, and a page as tall as the rail", () => {
    renderWorld();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Show a robot once. Get the data to teach it.");
    expect(current()).toBe("story");
    const track = document.querySelector<HTMLElement>(".world-track")!;
    expect(parseFloat(track.style.height)).toBeGreaterThan(window.innerHeight * 10);
  });

  it("follows the scroll from station to station, and the journey rail marks where you are", () => {
    renderWorld();
    const h = window.innerHeight;
    // story 3, descent 0.6 + 2.5, workshop 0.6 + 1.5 viewport heights
    scrollTo(h * (3 + 3.1 + 0.6 + 0.2));
    expect(current()).toBe("workshop");
    const rail = screen.getByRole("navigation", { name: "Journey" });
    expect(within(rail).getByRole("button", { name: "Workshop" }).getAttribute("aria-current")).toBe("step");
  });

  it("chooses a cartridge in the workshop and opens its route at the end of the zoom", () => {
    vi.useFakeTimers();
    renderWorld();
    const h = window.innerHeight;
    scrollTo(h * 6.8);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("button", { name: "Review" }).getAttribute("aria-pressed")).toBe("true");
    scrollTo(h * 11);
    expect(current()).toBe("zoom");
    scrollTo(h * 100);
    act(() => vi.runAllTimers());
    expect(screen.getByRole("heading", { name: "Review page" })).toBeTruthy();
    expect(sessionStorage.getItem("world.return")).toBe("machine");
  });

  it("hands off now with the zoom's button, to Record by default", () => {
    renderWorld();
    fireEvent.click(screen.getByRole("button", { name: "Open Record" }));
    expect(screen.getByRole("heading", { name: "Record page" })).toBeTruthy();
  });

  it("opens the workbench as a branch, holds the page, and goes back on Escape", () => {
    renderWorld();
    scrollTo(window.innerHeight * 6.8);
    fireEvent.click(screen.getByRole("button", { name: "Add a cartridge" }));
    expect(current()).toBe("workbench");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.activeElement?.getAttribute("data-station")).toBe("workbench");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(current()).toBe("workshop");
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("shows the current station's pre-rendered still in place of the canvas", () => {
    renderWorld();
    const on = () => document.querySelector<HTMLImageElement>('.world-stills__img[data-on="true"]')?.getAttribute("src");
    expect(document.querySelector(".world-canvas")).toBeNull();
    expect(on()).toMatch(/stills\/story\.webp$/);
    scrollTo(window.innerHeight * 6.8);
    expect(on()).toMatch(/stills\/workshop\.webp$/);
  });

  it("comes back from a 2D route to the machine, without leaving again", () => {
    sessionStorage.setItem("world.return", "machine");
    renderWorld();
    expect(current()).toBe("machine");
    expect(window.scrollTo).toHaveBeenCalled();
    expect(sessionStorage.getItem("world.return")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Record page" })).toBeNull();
  });
});
