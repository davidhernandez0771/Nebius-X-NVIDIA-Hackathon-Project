// The world without WebGL (jsdom has none, and ?static forces it): the overlays, the journey rail,
// the workshop's cartridge choice, the workbench branch and the handoff to a 2D route all work.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant";
import { INTRO_VH } from "../stations/intro/storyline";
import { edgeStart, MARGIN, PLAN, sectionShown, SLANT } from "../ui/wipe";
import WorldRoot from "./WorldRoot";

/** The intro's length in viewport heights (the hero and its breaks); everything after it is offset by it. */
const INTRO = INTRO_VH;

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

  it("opens on the intro, with the title, and a page as tall as the rail", () => {
    renderWorld();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Show a robot once. Get the data to teach it.");
    expect(current()).toBe("intro");
    const track = document.querySelector<HTMLElement>(".world-track")!;
    expect(parseFloat(track.style.height)).toBeGreaterThan(window.innerHeight * 10);
  });

  it("uncovers the intro's sections one at a time with the breaks, then hands the 3D back", () => {
    renderWorld();
    const h = window.innerHeight;
    const bands = () => [...document.querySelectorAll<HTMLElement>(".world-break")];
    const shown = () => bands().flatMap((b, k) => (b.dataset.live === "true" ? [k] : []));
    expect(bands()).toHaveLength(PLAN.sections);
    expect(shown()).toEqual([]);
    // Halfway up the first edge: the problem's slab is coming up, its text held in place.
    scrollTo(h * (edgeStart(0) + PLAN.wipe / 2));
    expect(shown()).toEqual([0]);
    const y = 100 + MARGIN - 0.5 * (100 + SLANT + 2 * MARGIN);
    expect(bands()[0].style.transform).toBe(`translate3d(0, ${y}vh, 0)`);
    expect(bands()[0].querySelector<HTMLElement>(".world-break__box")!.style.transform).toBe(`translate3d(0, ${-y}vh, 0)`);
    // S·A·N·T in full, its headline on.
    scrollTo(h * (sectionShown(1) + PLAN.dwell / 2));
    expect(shown()).toEqual([1]);
    expect(bands()[1].dataset.on).toBe("true");
    expect(bands()[1].textContent).toContain("Neaten");
    expect(bands()[0].dataset.on).toBe("false");
    // Past the last edge: the descent, clear.
    scrollTo(h * (INTRO + 0.5));
    expect(shown()).toEqual([]);
    expect(current()).toBe("descent");
  });

  it("follows the scroll from station to station, and the journey rail marks where you are", () => {
    renderWorld();
    const h = window.innerHeight;
    // intro, descent 2.5, workshop 1.1 (the dive) + its dwell, in viewport heights
    scrollTo(h * (INTRO + 2.5 + 0.6 + 0.2));
    expect(current()).toBe("workshop");
    const rail = screen.getByRole("navigation", { name: "Journey" });
    expect(within(rail).getByRole("button", { name: "Workshop" }).getAttribute("aria-current")).toBe("step");
  });

  it("sends a robot's cartridge from the workshop to the machine, and opens Record at the end of the zoom", () => {
    vi.useFakeTimers();
    renderWorld();
    const h = window.innerHeight;
    scrollTo(h * (INTRO + 3.8));
    vi.mocked(window.scrollTo).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "PiPER" }));
    // The journey follows it to the machine.
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Open PiPER" })).toBeTruthy();
    // intro, descent 2.5, workshop 1.1 + 7.6, machine 0.8 + 1.6, zoom 1.4 viewport heights
    scrollTo(h * (INTRO + 14.5));
    expect(current()).toBe("zoom");
    scrollTo(h * 100);
    act(() => vi.runAllTimers());
    expect(screen.getByRole("heading", { name: "Record page" })).toBeTruthy();
    expect(sessionStorage.getItem("world.return")).toBe("machine");
  });

  it("hands off now with the zoom's button, to Record with the SO-101 by default", () => {
    renderWorld();
    fireEvent.click(screen.getByRole("button", { name: "Open SO-101" }));
    expect(screen.getByRole("heading", { name: "Record page" })).toBeTruthy();
  });

  it("opens the workbench as a branch, holds the page, and goes back on Escape", () => {
    renderWorld();
    scrollTo(window.innerHeight * (INTRO + 3.8));
    fireEvent.click(screen.getByRole("button", { name: "+ Add a cartridge" }));
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
    scrollTo(window.innerHeight * (INTRO + 3.8));
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

describe("the spiral's filters (no WebGL)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    sessionStorage.clear();
  });
  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    (await import("../scene/spiral")).resetSpiral();
  });

  it("slides a tag's cartridges to the top, back to the first step, and clears on a second press or Escape", async () => {
    const { spiral, stepCount } = await import("../scene/spiral");
    renderWorld();
    scrollTo(window.innerHeight * (INTRO + 5));
    const results = screen.getByRole("button", { name: "-> results" });
    fireEvent.click(results);
    expect(results.getAttribute("aria-pressed")).toBe("true");
    expect(spiral.filter).toBe("results");
    expect(stepCount()).toBe(4);
    expect(window.scrollTo).toHaveBeenCalled();
    fireEvent.click(results);
    expect(spiral.filter).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "-> train" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(spiral.filter).toBeNull();
  });

  it("opens the front cartridge's detail on Enter, closes it on Escape, and plugs it in", async () => {
    const { spiral } = await import("../scene/spiral");
    renderWorld();
    // Step 0: intro 3 + descent 2.5 + the workshop's dive 1.1 and way in 0.7 viewport heights.
    scrollTo(window.innerHeight * (INTRO + 4.3));
    fireEvent.keyDown(window, { key: "Enter" });
    const dialog = screen.getByRole("dialog", { name: "RECORD, cartridge" });
    expect(within(dialog).getByText("2026 / FR3 / record a demo")).toBeTruthy();
    expect(document.documentElement.style.overflow).toBe("hidden");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(spiral.selected).toBe(-1);
    expect(document.documentElement.style.overflow).toBe("");
    fireEvent.keyDown(window, { key: "Enter" });
    // Without the canvas there is no plug-in to watch: Plug in opens the page.
    fireEvent.click(screen.getByRole("button", { name: "Plug in →" }));
    expect(screen.getByRole("heading", { name: "Record page" })).toBeTruthy();
  });

  it("asks SANT: runs the model's tool and shows the call line, or the keyword rules when it is down", async () => {
    const { spiral } = await import("../scene/spiral");
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ tool: "show_cartridges_with_tag", arg: "results", reply: "Here is what the runs scored." }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWorld();
    scrollTo(window.innerHeight * (INTRO + 5));
    const input = screen.getByRole("textbox", { name: "Ask SANT" });
    fireEvent.change(input, { target: { value: "how well does it work?" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    expect(spiral.filter).toBe("results");
    expect(screen.getByText('› show_cartridges_with_tag("results")')).toBeTruthy();
    expect(screen.getByText("Here is what the runs scored.")).toBeTruthy();

    fetchMock.mockImplementation(async () => Promise.reject(new Error("offline")));
    fireEvent.change(input, { target: { value: "open the grasp fix" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    expect(screen.getByText('› open_cartridge("grasp-fix") · rules')).toBeTruthy();
    expect(spiral.selected).toBe(5);
    vi.unstubAllGlobals();
  });

  it("lists the cartridges as buttons without the 3D spiral, filtered too", async () => {
    const { spiral } = await import("../scene/spiral");
    renderWorld();
    scrollTo(window.innerHeight * (INTRO + 5));
    const list = screen.getByRole("list", { name: "Cartridges" });
    expect(within(list).getAllByRole("button")).toHaveLength(24);
    fireEvent.click(screen.getByRole("button", { name: "-> bring your robot" }));
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["BRING ROBOT", "FRANKA", "OPENARM", "SO-101"]);
    fireEvent.click(within(list).getByRole("button", { name: "OPENARM" }));
    expect(spiral.selected).toBe(18);
    expect(screen.getByRole("dialog", { name: "OPENARM, cartridge" })).toBeTruthy();
  });
});
