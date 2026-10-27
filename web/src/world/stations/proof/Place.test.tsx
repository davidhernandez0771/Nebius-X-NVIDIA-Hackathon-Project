// The proof wall (proof-wall, 2026-10-26, the user): the story's four proof beats also live in the workshop, as a
// place on the room's back wall, opened like the machine, the bench and the robot wall (a hub tag, the hub bar, the
// journey rail, #proof in the URL), with the same way out (Back to room, Escape, the browser's Back, a reload). Inside
// it the four figures (ui/proofFigures.tsx, the story's own) step through as panels, each graph drawing in when its
// panel opens. Rendered in the whole world without WebGL (jsdom has none).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../../sant";
import { CLIMB, GOAL, LEAD, TEACHER, TEACHER_GATE } from "../../../site/results/proofData";
import WorldRoot from "../../core/WorldRoot";
import { INTRO_VH } from "../intro/storyPlan";
import { ENTER_MS, PLAY_MS } from "./Place";

/** The room view: the intro, the descent (3) and the workshop's travel (1.4, the materialize). */
const HUB = INTRO_VH + 3 + 1.4 + 0.1;

function renderWorld() {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={["/world"]}>
        <Routes>
          <Route path="/world" element={<WorldRoot webgl={false} />} />
          <Route path="/test-track" element={<h1>Test track</h1>} />
        </Routes>
      </MemoryRouter>
    </MotionProvider>,
  );
}

function scrollTo(y: number) {
  act(() => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    window.dispatchEvent(new Event("scroll"));
  });
}

const current = () => document.querySelector<HTMLElement>('.world-station[data-current="true"]')?.dataset.station;
const hub = () => scrollTo(window.innerHeight * HUB);
const goProof = () => fireEvent.click(within(screen.getByRole("group", { name: "Go to" })).getByRole("button", { name: "Proof" }));
const place = () => screen.getByRole("region", { name: "The proof wall" });
/** The panel on show: the one region inside the place (the others are hidden). */
const panel = () => within(place()).getAllByRole("region")[0];
const heading = () => within(panel()).getByRole("heading", { level: 2 }).textContent?.replace(/\s+/g, " ").trim();
const scaleOf = (el: HTMLElement) => parseFloat(/scaleX\(([-\d.e]+)\)/.exec(el.style.transform)?.[1] ?? "NaN");

// The panels' plays run on requestAnimationFrame: the test holds the frames and runs them at times it picks.
let frames: FrameRequestCallback[] = [];
const tick = (ms: number) =>
  act(() => {
    const due = frames;
    frames = [];
    due.forEach((f) => f(ms));
  });
/** Plays the open panel's graph through: its first frame, then past its length (and the way in, on entering). */
const playThrough = () => {
  tick(1000);
  tick(1000 + ENTER_MS + PLAY_MS + 50);
};

describe("the proof wall in the workshop (no WebGL)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => (frames.push(f), frames.length));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("opens from the hub bar like the other places: #proof in the URL, Back to room top left, Escape goes back", async () => {
    renderWorld();
    hub();
    goProof();
    expect(current()).toBe("proof");
    expect(window.location.hash).toBe("#proof");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.activeElement?.getAttribute("data-station")).toBe("proof");
    const bar = screen.getByRole("group", { name: "The proof: the way out" });
    expect(bar.textContent).toContain("Esc goes back");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(current()).toBe("workshop");
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(document.documentElement.style.overflow).toBe("");
    // And out by its own button.
    goProof();
    fireEvent.click(within(screen.getByRole("group", { name: "The proof: the way out" })).getByRole("button", { name: "Back to room" }));
    expect(current()).toBe("workshop");
    await waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("opens from the journey rail's PROOF straight from the story, inside the room", () => {
    renderWorld();
    expect(current()).toBe("intro");
    const rail = screen.getByRole("navigation", { name: "Journey" });
    fireEvent.click(within(rail).getByRole("button", { name: "Proof" }));
    expect(current()).toBe("proof");
    const ys = vi.mocked(window.scrollTo).mock.calls.map((c) => (c[0] as ScrollToOptions).top ?? 0);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(window.innerHeight * (INTRO_VH + 3 + 0.8) - 1);
    expect(within(rail).getByRole("button", { name: "Proof" }).getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getAllByRole("button", { name: /Back to room/ }).slice(-1)[0]);
    expect(current()).toBe("workshop");
  });

  it("closes on the browser's Back and opens again on Forward", async () => {
    renderWorld();
    hub();
    const before = window.history.length;
    goProof();
    expect(window.history.length).toBe(before + 1);
    act(() => window.history.back());
    await waitFor(() => expect(current()).toBe("workshop"));
    expect(window.location.hash).toBe("");
    act(() => window.history.forward());
    await waitFor(() => expect(current()).toBe("proof"));
  });

  it("a reload (or a link) with #proof opens it in the room", () => {
    window.history.replaceState(null, "", "/#proof");
    renderWorld();
    expect(current()).toBe("proof");
    expect(heading()).toBe(`${LEAD.demos} demos in. A tested robot out.`);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(current()).toBe("workshop");
    expect(window.location.hash).toBe("");
  });

  it("steps through the story's four panels: Next and Previous, the arrow keys, the dots", () => {
    renderWorld();
    hub();
    goProof();
    const nav = within(screen.getByRole("navigation", { name: "The proof's panels" }));
    const next = nav.getByRole("button", { name: "Next panel" });
    const prev = nav.getByRole("button", { name: "Previous panel" });
    const dots = nav.getAllByRole("button", { name: /^Panel \d of 4/ });
    expect(dots).toHaveLength(4);
    // One panel at a time, the first first.
    expect(within(place()).getAllByRole("region")).toHaveLength(1);
    expect(heading()).toBe(`${LEAD.demos} demos in. A tested robot out.`);
    expect(prev.hasAttribute("disabled")).toBe(true);
    expect(dots[0].getAttribute("aria-current")).toBe("step");
    fireEvent.click(next);
    expect(heading()).toBe(`${CLIMB[0].k}/${CLIMB[0].n} → ${CLIMB[3].k}/${CLIMB[3].n}`);
    expect(dots[1].getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("Panel 2 of 4: The proof")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(heading()).toBe("Did the human demos matter?");
    fireEvent.click(dots[3]);
    expect(heading()).toBe("SANT checks the teacher too");
    expect(next.hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(heading()).toBe("SANT checks the teacher too");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(heading()).toBe("Did the human demos matter?");
    fireEvent.click(prev);
    fireEvent.click(prev);
    expect(heading()).toBe(`${LEAD.demos} demos in. A tested robot out.`);
    // Closed and opened again: it starts at the first panel.
    fireEvent.click(next);
    fireEvent.keyDown(window, { key: "Escape" });
    goProof();
    expect(heading()).toBe(`${LEAD.demos} demos in. A tested robot out.`);
    // The arrows belong to the place only while it is open.
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    goProof();
    expect(heading()).toBe(`${LEAD.demos} demos in. A tested robot out.`);
  });

  it("draws each graph in when its panel opens, from nothing to whole", () => {
    renderWorld();
    hub();
    goProof();
    // The pipeline: no step lit as it opens, nor while the camera turns to the wall; all five once played.
    const lit = () => panel().querySelectorAll('li[data-lit="true"]').length;
    expect(lit()).toBe(0);
    tick(1000);
    tick(1000 + ENTER_MS - 50);
    expect(lit()).toBe(0);
    tick(1000 + ENTER_MS + PLAY_MS / 2);
    expect(lit()).toBeGreaterThan(0);
    expect(lit()).toBeLessThan(5);
    tick(1000 + ENTER_MS + PLAY_MS + 50);
    expect(lit()).toBe(5);
    // The climb: its bars start at nothing and grow to the counts.
    fireEvent.click(screen.getByRole("button", { name: "Next panel" }));
    const bars = () => [...panel().querySelectorAll<HTMLElement>(".intro-pbeat__bar")].map(scaleOf);
    const counts = () => [...panel().querySelectorAll<HTMLElement>(".intro-pbeat__count > span")].map((c) => c.textContent);
    expect(bars()[3]).toBe(0);
    expect(counts()[3]).toBe("0");
    playThrough();
    bars().forEach((v, i) => expect(v).toBeCloseTo(CLIMB[i].k / CLIMB[i].n, 6));
    expect(counts()).toEqual(CLIMB.map((s) => String(s.k)));
    // Back to it: it plays again.
    fireEvent.click(screen.getByRole("button", { name: "Previous panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Next panel" }));
    expect(bars()[3]).toBe(0);
    playThrough();
    expect(bars()[3]).toBeCloseTo(CLIMB[3].k / CLIMB[3].n, 6);
    // The teacher's readout reaches the last checkpoint; the gate's tallies fill.
    fireEvent.click(screen.getByRole("button", { name: "Next panel" }));
    playThrough();
    expect(panel().querySelector(".intro-pbeat__readout")!.textContent).toContain(`${TEACHER.final.withDemos.k}/${TEACHER.n}`);
    fireEvent.click(screen.getByRole("button", { name: "Next panel" }));
    expect(panel().querySelectorAll('.intro-pbeat__tally [data-on="true"]')).toHaveLength(0);
    playThrough();
    expect(panel().querySelectorAll('.intro-pbeat__tally [data-on="true"]')).toHaveLength(TEACHER_GATE.before.n + TEACHER_GATE.after.n);
  });

  it("with reduced motion, shows each graph whole the moment its panel opens", () => {
    localStorage.setItem("sant.effects", "off");
    renderWorld();
    hub();
    goProof();
    expect(panel().querySelectorAll('li[data-lit="true"]')).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Next panel" }));
    [...panel().querySelectorAll<HTMLElement>(".intro-pbeat__bar")].forEach((b, i) => expect(scaleOf(b)).toBeCloseTo(CLIMB[i].k / CLIMB[i].n, 6));
    fireEvent.click(screen.getByRole("button", { name: "Next panel" }));
    expect(panel().querySelector(".intro-pbeat__readout")!.textContent).toContain(`${TEACHER.final.withDemos.k}/${TEACHER.n}`);
    fireEvent.click(screen.getByRole("button", { name: "Next panel" }));
    expect(panel().querySelectorAll('.intro-pbeat__tally [data-on="true"]')).toHaveLength(TEACHER_GATE.before.n + TEACHER_GATE.after.n);
    // Nothing was left to play.
    expect(frames).toHaveLength(0);
  });

  it("tells the numbers from proofData, as the story does", () => {
    renderWorld();
    hub();
    goProof();
    expect(panel().textContent).toContain(`Record ${LEAD.demos} demos`);
    fireEvent.click(screen.getByRole("button", { name: "Next panel" }));
    const table = within(panel()).getByRole("table");
    for (const s of CLIMB) expect(within(table).getByRole("row", { name: new RegExp(`^${s.tag}`) }).textContent).toContain(`${s.k}/${s.n}`);
    expect(panel().textContent).toContain(`${GOAL.k}/${GOAL.n}`);
    expect(panel().querySelectorAll(".intro-pbeat__whisker")).toHaveLength(CLIMB.length);
    fireEvent.click(screen.getByRole("button", { name: "Next panel" }));
    for (const c of TEACHER.curve) expect(within(within(panel()).getByRole("table")).getByRole("row", { name: new RegExp(`^${c.iteration}`) }).textContent).toContain(`${c.withDemos}/${TEACHER.n}`);
    fireEvent.click(screen.getByRole("button", { name: "Next panel" }));
    const { before, after, passMark } = TEACHER_GATE;
    for (const s of [`${before.k}/${before.n}`, `${after.k}/${after.n}`, `${passMark.k}/${passMark.n}`]) expect(panel().textContent).toContain(s);
  });

  it("ends with the same two links as the story: the real test runs and every number with its sources", () => {
    renderWorld();
    hub();
    goProof();
    const links = within(place());
    expect(links.getByRole("link", { name: /Watch the real test runs/ }).getAttribute("href")).toBe("/test-track");
    expect(links.getByRole("link", { name: /Every number, with its sources/ }).getAttribute("href")).toBe("/site/results#proof");
    // Once each, after the panels.
    expect(links.getAllByRole("link")).toHaveLength(2);
  });

  it("leaves the story's beats as they were", () => {
    renderWorld();
    expect(document.querySelectorAll(".intro-pbeat")).toHaveLength(4);
    const story = screen.getByRole("region", { name: "Story" });
    expect(within(story).getByRole("region", { name: /06 \/ The proof/ })).toBeTruthy();
  });
});
