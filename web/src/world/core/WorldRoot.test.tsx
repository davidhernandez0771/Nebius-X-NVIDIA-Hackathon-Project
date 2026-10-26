// The world without WebGL (jsdom has none, and ?static forces it): the overlays, the journey rail,
// the workshop's cartridge choice, the workbench branch and the handoff to a 2D route all work.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../sant";
import { PROOF } from "../stations/intro/proof";
import { beatSpan, INTRO_VH } from "../stations/intro/storyPlan";
import WorldRoot from "./WorldRoot";

/** The intro's length in viewport heights (the hero, its beats and the morph); everything after it is offset by it. */
const INTRO = INTRO_VH;
/** The room view: the intro, the descent (3) and the workshop's travel (1.4, the materialize). */
const HUB = INTRO + 3 + 1.4 + 0.1;

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
    // An open place is in the URL's hash (placeHash.ts): start each test without one.
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("signs the page top left with the SANT lockup and its line, over the stills too", () => {
    renderWorld();
    const brand = document.querySelector<HTMLElement>(".world-brand")!;
    expect(within(brand).getByRole("img", { name: "SANT" })).toBeTruthy();
    expect(brand.querySelectorAll(".sant-logo__unit").length).toBe(4);
    expect(brand.textContent).toContain("perfect, then multiply");
    expect(brand.textContent).not.toContain("S·A·N·T");
    // No WebGL here: the stills are the ground the brand sits on.
    expect(document.querySelector(".world-stills")).toBeTruthy();
  });

  it("opens on the intro, with the title, and a page as tall as the rail", () => {
    renderWorld();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Show a robot once. Get the data to teach it.");
    expect(current()).toBe("intro");
    const track = document.querySelector<HTMLElement>(".world-track")!;
    expect(parseFloat(track.style.height)).toBeGreaterThan(window.innerHeight * 10);
  });

  it("tells the story beside the logo one beat at a time, then hands over to the descent", () => {
    renderWorld();
    const h = window.innerHeight;
    const beats = () => [...document.querySelectorAll<HTMLElement>(".intro-beat")];
    const shown = () => beats().flatMap((b, k) => (parseFloat(b.style.opacity) > 0.5 ? [k] : []));
    expect(beats()).toHaveLength(5);
    // The hero, before any scroll.
    expect(shown()).toEqual([0]);
    const head = (k: number) => beats()[k].querySelector("h2")!.getAttribute("aria-label");
    expect(head(0)).toBe("Show a robot once.");
    // S·A·N·T in the middle of its span, alone.
    const [a, b] = beatSpan(2);
    scrollTo(h * ((a + b) / 2));
    expect(shown()).toEqual([2]);
    expect(head(2)).toBe("Simulate Augment Neaten Train");
    // The proof, with the honest numbers.
    const [c, d] = beatSpan(3);
    scrollTo(h * ((c + d) / 2));
    expect(shown()).toEqual([3]);
    expect(head(3)).toBe("3/40 → 17/40");
    expect(beats()[3].textContent).toContain("p = 0.0005");
    // ... read from the Results page's data (site/results), so updating the results updates the story
    expect(head(3)).toBe(`${PROOF.raw} → ${PROOF.multiplied}`);
    expect(beats()[3].textContent).toContain(`${PROOF.webcam.passed} passed physics → ${PROOF.webcam.repaired} repaired → ${PROOF.webcam.copies} verified variants`);
    expect(beats()[3].textContent).toContain(`Nemotron labels: ${PROOF.labels}`);
    expect(beats()[1].textContent).toContain(`${PROOF.pressed.split("/")[0]} of our ${PROOF.webcam.demos} webcam demos`);
    expect(beats()[1].textContent).toContain(PROOF.peak);
    // Past the intro: the descent, no beat left on screen.
    scrollTo(h * (INTRO + 0.5));
    expect(shown()).toEqual([]);
    expect(current()).toBe("descent");
  });

  it("follows the scroll from station to station, and the journey rail marks where you are", () => {
    renderWorld();
    const h = window.innerHeight;
    // intro, descent 3, then into the workshop's travel (the materialize), in viewport heights
    scrollTo(h * (INTRO + 3 + 1));
    expect(current()).toBe("workshop");
    const rail = screen.getByRole("navigation", { name: "Journey" });
    expect(within(rail).getByRole("button", { name: "Workshop" }).getAttribute("aria-current")).toBe("step");
  });

  it("sends a robot's cartridge from the workshop to the machine, then into the projection and Record", () => {
    renderWorld();
    const h = window.innerHeight;
    // The workshop (the room view).
    scrollTo(h * HUB);
    expect(current()).toBe("workshop");
    vi.mocked(window.scrollTo).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "PiPER" }));
    // The machine is a branch now: a click opens it, the page doesn't scroll.
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(current()).toBe("machine");
    fireEvent.click(screen.getByRole("button", { name: "Into the projection →" }));
    expect(current()).toBe("zoom");
    // Without the canvas the zoom can't play: its button opens the page.
    fireEvent.click(screen.getByRole("button", { name: "Open PiPER" }));
    expect(screen.getByRole("heading", { name: "Record page" })).toBeTruthy();
    expect(sessionStorage.getItem("world.return")).toBe("machine");
  });

  // site-nav: the caption says what the hologram shows (scene/projection.ts), for the cartridge plugged in.
  it("captions the machine with what it projects: the Franka's replay, honest about the SO-101", () => {
    renderWorld();
    scrollTo(window.innerHeight * HUB);
    fireEvent.click(within(screen.getByRole("group", { name: "Go to" })).getByRole("button", { name: "Machine" }));
    const machine = document.querySelector('.world-station[data-station="machine"]')!;
    expect(machine.textContent).toContain("SO-101 plugs in. The SO-101 has no verified replay yet, so the machine projects the Franka FR3's");
    fireEvent.click(screen.getAllByRole("button", { name: /Back to room/ }).slice(-1)[0]);
    fireEvent.click(screen.getByRole("button", { name: "Franka FR3" }));
    expect(machine.textContent).toContain("Franka FR3 plugs in, and the machine projects it");
  });

  it("hands off now with the zoom's button, to Record with the SO-101 by default", () => {
    renderWorld();
    fireEvent.click(screen.getByRole("button", { name: "Open SO-101" }));
    expect(screen.getByRole("heading", { name: "Record page" })).toBeTruthy();
  });

  it("opens the workbench as a branch, holds the page, and goes back on Escape", () => {
    renderWorld();
    scrollTo(window.innerHeight * HUB);
    fireEvent.click(screen.getByRole("button", { name: "+ Add a cartridge" }));
    expect(current()).toBe("workbench");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.activeElement?.getAttribute("data-station")).toBe("workbench");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(current()).toBe("workshop");
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("offers a skip-the-intro link first in the Tab order; it lands in the room view and focuses it", async () => {
    renderWorld();
    const link = screen.getByRole("link", { name: "Skip the intro" });
    expect(document.querySelector(".world")!.querySelector("a[href], button, input, select, textarea")).toBe(link);
    fireEvent.click(link);
    expect(current()).toBe("workshop");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-station")).toBe("workshop"));
  });

  it("opens the robot wall's catalog from the room view, and goes back on Escape", () => {
    renderWorld();
    scrollTo(window.innerHeight * HUB);
    fireEvent.click(within(screen.getByRole("group", { name: "Go to" })).getByRole("button", { name: "Robots" }));
    expect(current()).toBe("robots");
    expect(document.activeElement?.getAttribute("data-station")).toBe("robots");
    expect(screen.getByRole("heading", { level: 2, name: "The robots" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(current()).toBe("workshop");
  });

  it("shows the current station's pre-rendered still in place of the canvas", () => {
    renderWorld();
    const on = () => document.querySelector<HTMLImageElement>('.world-stills__img[data-on="true"]')?.getAttribute("src");
    expect(document.querySelector(".world-canvas")).toBeNull();
    expect(on()).toMatch(/stills\/story\.webp$/);
    scrollTo(window.innerHeight * HUB);
    expect(on()).toMatch(/stills\/workshop\.webp$/);
  });

  // site-nav (2026-10-26), the user's bug 2: the journey rail's MACHINE (or WORKBENCH, ROBOTS) straight from the
  // story opened the place over an unbuilt room (black), and Back to room landed back in the story.
  it.each([
    ["Machine", "machine"],
    ["Workbench", "workbench"],
    ["Robots", "robots"],
  ])("opens %s from the story inside the room: the rail cuts to the workshop first, and Back lands in the room", (label, id) => {
    renderWorld();
    expect(current()).toBe("intro");
    const room = window.innerHeight * (INTRO + 3 + 0.8);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Journey" })).getByRole("button", { name: label }));
    expect(current()).toBe(id);
    // The page went to the room view under the place (the workshop's dwell), with no glide.
    const ys = vi.mocked(window.scrollTo).mock.calls.map((c) => (c[0] as ScrollToOptions).top ?? 0);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(room - 1);
    fireEvent.click(screen.getAllByRole("button", { name: /Back to room/ }).slice(-1)[0]);
    expect(current()).toBe("workshop");
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

// site-nav (2026-10-26): the browser's own Back (a phone's back gesture) inside a place left the site, and a
// reload dropped you at the top of the story. The open place is in the URL's hash now (placeHash.ts).
describe("the browser's Back and Forward in the workshop (no WebGL)", () => {
  const hub = () => scrollTo(window.innerHeight * HUB);
  const goMachine = () => fireEvent.click(within(screen.getByRole("group", { name: "Go to" })).getByRole("button", { name: "Machine" }));
  beforeEach(() => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("opening a place adds a history entry: Back closes it, Forward opens it again", async () => {
    renderWorld();
    hub();
    const before = window.history.length;
    goMachine();
    expect(current()).toBe("machine");
    expect(window.location.hash).toBe("#machine");
    expect(window.history.length).toBe(before + 1);
    act(() => window.history.back());
    await waitFor(() => expect(current()).toBe("workshop"));
    expect(window.location.hash).toBe("");
    act(() => window.history.forward());
    await waitFor(() => expect(current()).toBe("machine"));
  });

  it("its own Back to room (or Escape) takes the entry back off, so the next Back doesn't reopen it", async () => {
    renderWorld();
    hub();
    goMachine();
    fireEvent.click(screen.getAllByRole("button", { name: /Back to room/ }).slice(-1)[0]);
    expect(current()).toBe("workshop");
    await waitFor(() => expect(window.location.hash).toBe(""));
    // Into another place and out by Escape: the same.
    fireEvent.click(within(screen.getByRole("group", { name: "Go to" })).getByRole("button", { name: "Robots" }));
    expect(window.location.hash).toBe("#robots");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(current()).toBe("workshop");
    await waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("into the projection stays on the machine's entry", () => {
    renderWorld();
    hub();
    goMachine();
    const len = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "Into the projection →" }));
    expect(current()).toBe("zoom");
    expect(window.location.hash).toBe("#machine");
    expect(window.history.length).toBe(len);
  });

  it("a reload (or a link) with a place in the URL opens it in the room", () => {
    window.history.replaceState(null, "", "/#robots");
    renderWorld();
    expect(current()).toBe("robots");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(current()).toBe("workshop");
    expect(window.location.hash).toBe("");
  });
});

// site-nav (2026-10-26, the user): a reload in the story or the descent starts where the visitor was, not at the top.
describe("a reload resumes the journey (no WebGL)", () => {
  const reloadNav = (type: string) =>
    vi.spyOn(performance, "getEntriesByType").mockImplementation(((t: string) => (t === "navigation" ? [{ type }] : [])) as never);
  beforeEach(() => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  const ys = () => vi.mocked(window.scrollTo).mock.calls.map((c) => (c[0] as ScrollToOptions).top ?? 0);

  it("keeps where the page is when it goes away, and comes back there on a reload", () => {
    const { unmount } = renderWorld();
    const y = window.innerHeight * (INTRO + 1.5);
    scrollTo(y);
    expect(current()).toBe("descent");
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    unmount();
    // A reload opens at the top of the page, before the world puts it back.
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.mocked(window.scrollTo).mockClear();
    reloadNav("reload");
    renderWorld();
    expect(current()).toBe("descent");
    expect(Math.abs(Math.max(...ys()) - y)).toBeLessThan(2);
  });

  it("a new visit (not a reload) still starts at the top", () => {
    sessionStorage.setItem("world.spot", JSON.stringify({ u: 0.5 }));
    reloadNav("navigate");
    renderWorld();
    expect(current()).toBe("intro");
    expect(ys().filter((y) => y > 0)).toEqual([]);
  });

  it("a place in the URL wins over the spot", () => {
    sessionStorage.setItem("world.spot", JSON.stringify({ u: 0.1 }));
    window.history.replaceState(null, "", "/#robots");
    reloadNav("reload");
    renderWorld();
    expect(current()).toBe("robots");
  });
});

describe("the spiral's filters (no WebGL)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    sessionStorage.clear();
    // An open place is in the URL's hash (placeHash.ts): start each test without one.
    window.history.replaceState(null, "", "/");
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
    // The shelf opens on the first match, in place: the page doesn't scroll in the workshop.
    expect((await import("../stations/workshop/stepper")).shelf.open).toBe(true);
    fireEvent.click(results);
    expect(spiral.filter).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "-> train" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(spiral.filter).toBeNull();
  });

  it("opens the front cartridge's detail on Enter, closes it on Escape, and plugs it in", async () => {
    const { spiral } = await import("../scene/spiral");
    renderWorld();
    const { shelf } = await import("../stations/workshop/stepper");
    // The room view, then the shelf (a filter opens it on its first match).
    scrollTo(window.innerHeight * (INTRO + 3.7));
    fireEvent.click(screen.getByRole("button", { name: "-> record a demo" }));
    expect(shelf.open).toBe(true);
    fireEvent.keyDown(window, { key: "Enter" });
    const dialog = screen.getByRole("dialog", { name: "RECORD, cartridge" });
    expect(within(dialog).getByText("2026 / FR3 / record a demo")).toBeTruthy();
    expect(document.documentElement.style.overflow).toBe("hidden");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(spiral.selected).toBe(-1);
    // Back on the shelf it came from.
    expect(shelf.open).toBe(true);
    fireEvent.keyDown(window, { key: "Enter" });
    // site-nav (2026-10-26, the user): Plug in stops at the machine's projection; Record opens only from a button.
    fireEvent.click(screen.getByRole("button", { name: "Plug in →" }));
    expect(screen.queryByRole("heading", { name: "Record page" })).toBeNull();
    expect(current()).toBe("machine");
    fireEvent.click(screen.getByRole("button", { name: "Into the projection →" }));
    expect(current()).toBe("zoom");
    fireEvent.click(screen.getByRole("button", { name: "Open RECORD" }));
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

  // Every way out of the shelf gives back the camera, the scroll and the room's UI (site-fixes-1, bug 4).
  describe("leaving the shelf", () => {
    const openShelf = async () => {
      const { shelf } = await import("../stations/workshop/stepper");
      scrollTo(window.innerHeight * HUB);
      fireEvent.click(screen.getByRole("button", { name: "-> record a demo" }));
      expect(shelf.open).toBe(true);
      expect(document.documentElement.style.overflow).toBe("hidden");
      return shelf;
    };
    afterEach(async () => {
      const { setFilter, setSelected } = await import("../scene/spiral");
      const { shelf } = await import("../stations/workshop/stepper");
      shelf.open = false;
      setSelected(-1);
      setFilter(null);
    });

    it.each(["Story", "Descent"])("by the journey rail's %s: the shelf closes and the page scrolls again", async (to) => {
      renderWorld();
      const shelf = await openShelf();
      fireEvent.click(within(screen.getByRole("navigation", { name: "Journey" })).getByRole("button", { name: to }));
      await waitFor(() => expect(shelf.open).toBe(false), { timeout: 2000 });
      expect(document.documentElement.style.overflow).toBe("");
    });

    it("from a detail view by the journey rail: the detail closes with it", async () => {
      const { spiral } = await import("../scene/spiral");
      renderWorld();
      await openShelf();
      fireEvent.keyDown(window, { key: "Enter" });
      expect(spiral.selected).toBeGreaterThanOrEqual(0);
      fireEvent.click(within(screen.getByRole("navigation", { name: "Journey" })).getByRole("button", { name: "Story" }));
      await waitFor(() => expect(spiral.selected).toBe(-1), { timeout: 2000 });
      expect(document.documentElement.style.overflow).toBe("");
    });

    it("to the machine and back: back lands in the room view, not on a shelf with no UI", async () => {
      renderWorld();
      const shelf = await openShelf();
      fireEvent.click(screen.getByRole("button", { name: "PiPER" }));
      expect(current()).toBe("machine");
      expect(shelf.open).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: /Back to room/ }));
      expect(current()).toBe("workshop");
      expect(shelf.open).toBe(false);
      // The stills have no landed dive to hold: nothing holds the page now.
      expect(document.documentElement.style.overflow).toBe("");
    });

    it("by its own Back to room button, which says how to browse", async () => {
      renderWorld();
      const shelf = await openShelf();
      const bar = screen.getByRole("group", { name: "The shelf: the way out" });
      expect(bar.textContent).toMatch(/to browse/);
      fireEvent.click(within(bar).getByRole("button", { name: "Back to room" }));
      expect(shelf.open).toBe(false);
      expect(screen.queryByRole("group", { name: "The shelf: the way out" })).toBeNull();
      expect(document.documentElement.style.overflow).toBe("");
    });

    // site-nav: the detail view had no way back in the one place every other view has it (its Close sat in
    // its card, bottom left). The same bar now: a step back to the shelf first, then the room.
    it("from a detail view by the same bar: Back to shelf first, then Back to room", async () => {
      const { spiral } = await import("../scene/spiral");
      renderWorld();
      const shelf = await openShelf();
      fireEvent.keyDown(window, { key: "Enter" });
      expect(spiral.selected).toBeGreaterThanOrEqual(0);
      const bar = screen.getByRole("group", { name: "The shelf: the way out" });
      expect(within(bar).getAllByRole("button").map((b) => b.textContent)).toEqual(["← Back to shelf", "← Back to room"]);
      expect(bar.textContent).toContain("Esc steps back");
      fireEvent.click(within(bar).getByRole("button", { name: "Back to shelf" }));
      expect(spiral.selected).toBe(-1);
      expect(shelf.open).toBe(true);
      fireEvent.keyDown(window, { key: "Enter" });
      fireEvent.click(within(screen.getByRole("group", { name: "The shelf: the way out" })).getByRole("button", { name: "Back to room" }));
      expect(spiral.selected).toBe(-1);
      expect(shelf.open).toBe(false);
      expect(document.documentElement.style.overflow).toBe("");
    });

    it("to the robot wall and out on Escape: the same", async () => {
      renderWorld();
      const shelf = await openShelf();
      fireEvent.click(within(screen.getByRole("group", { name: "Go to" })).getByRole("button", { name: "Robots" }));
      expect(current()).toBe("robots");
      expect(shelf.open).toBe(false);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(current()).toBe("workshop");
      expect(document.documentElement.style.overflow).toBe("");
    });
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
