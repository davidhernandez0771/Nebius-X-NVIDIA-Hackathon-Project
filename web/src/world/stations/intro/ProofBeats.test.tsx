// The story's proof beats (intro-proof, 2026-10-26, the user): after the reactor's beats and before the ring, four
// beats hold the screen while their graphs draw with the scroll: how SANT works, the climb, the teacher with and
// without demo starts, the teacher's speed gate. Rendered in the whole world without WebGL (jsdom has none), so the
// rail, the resume and Skip the intro are checked with them in place.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../../sant";
import { CLIMB, CLIMB_FOOTNOTE_SHORT, GOAL, LEAD, TEACHER, TEACHER_GATE } from "../../../site/results/proofData";
import WorldRoot from "../../core/WorldRoot";
import { sourcesLine } from "./ProofBeats";
import { INTRO_VH, PROOF_BEATS, PROOF_DRAWN, proofBeatSpan, span } from "./storyPlan";

function renderWorld() {
  return render(
    <MotionProvider>
      <MemoryRouter initialEntries={["/world"]}>
        <Routes>
          <Route path="/world" element={<WorldRoot webgl={false} />} />
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

/** Scroll to share k of proof beat i's span. */
const scrollToBeat = (i: number, k: number) => {
  const [a, b] = proofBeatSpan(i);
  scrollTo(window.innerHeight * (a + (b - a) * k));
};
/** In the hold: whole and fully shown. */
const HOLD = (PROOF_DRAWN + 0.88) / 2;

const beats = () => [...document.querySelectorAll<HTMLElement>(".intro-pbeat")];
const shownBeats = () => beats().flatMap((b, i) => (parseFloat(b.style.opacity) > 0.5 ? [i] : []));
const storyShown = () => [...document.querySelectorAll<HTMLElement>(".intro-beat")].filter((b) => parseFloat(b.style.opacity) > 0.01).length;
const current = () => document.querySelector<HTMLElement>('.world-station[data-current="true"]')?.dataset.station;
/** A bar's drawn scale (its transform's scaleX). */
const scaleOf = (el: HTMLElement) => parseFloat(/scaleX\(([-\d.e]+)\)/.exec(el.style.transform)?.[1] ?? "NaN");
const ys = () => vi.mocked(window.scrollTo).mock.calls.map((c) => (c[0] as ScrollToOptions).top ?? 0);

describe("the story's proof beats (no WebGL)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("are four named beats, between the reactor's and the ring, one on screen at a time", () => {
    renderWorld();
    expect(beats()).toHaveLength(PROOF_BEATS);
    const story = screen.getByRole("region", { name: "Story" });
    const names = ["How SANT works", "The proof", "Did the human demos matter?", "SANT checks the teacher too"];
    names.forEach((n) => expect(within(story).getByRole("region", { name: new RegExp(n.replace("?", "\\?")) })).toBeTruthy());
    expect(shownBeats()).toEqual([]);
    for (let i = 0; i < PROOF_BEATS; i++) {
      scrollToBeat(i, HOLD);
      expect(shownBeats()).toEqual([i]);
      expect(storyShown()).toBe(0);
      expect(current()).toBe("intro");
    }
    // The ring: none left; past the intro, the descent.
    scrollTo(window.innerHeight * (span("ring")[0] + 0.5));
    expect(shownBeats()).toEqual([]);
    scrollTo(window.innerHeight * (INTRO_VH + 0.5));
    expect(current()).toBe("descent");
  });

  it("lays out the pipeline in five steps, its numbers from proofData", () => {
    renderWorld();
    const steps = within(beats()[0]).getAllByRole("listitem");
    expect(steps).toHaveLength(5);
    expect(steps[0].textContent).toContain(`Record ${LEAD.demos} demos`);
    expect(steps[0].textContent).toMatch(/mouse/i);
    expect(steps[1].textContent).toContain("Physics check in Isaac Lab");
    expect(steps[2].textContent).toMatch(/Repair \+ multiply/);
    expect(steps[3].textContent).toMatch(/RL teacher/);
    expect(steps[4].textContent).toContain(`${CLIMB[CLIMB.length - 1].n} unseen scenes`);
  });

  it("draws the climb from proofData, with the goal line, the Wilson intervals and the footnote", () => {
    renderWorld();
    const climb = beats()[1];
    const table = within(climb).getByRole("table");
    for (const s of CLIMB) {
      const row = within(table).getByRole("row", { name: new RegExp(`^${s.tag}`) });
      expect(row.textContent).toContain(`${s.k}/${s.n}`);
    }
    expect(climb.textContent).toContain(`${GOAL.k}/${GOAL.n}`);
    expect(climb.textContent).toContain(CLIMB_FOOTNOTE_SHORT);
    expect(climb.querySelectorAll(".intro-pbeat__whisker")).toHaveLength(CLIMB.length);
    expect(within(climb).getByRole("figure").getAttribute("aria-describedby")).toBeTruthy();
  });

  it("draws the teacher curve from proofData: with demo starts 0 → 113 of 128, without 0 throughout", () => {
    renderWorld();
    const table = within(beats()[2]).getByRole("table");
    for (const c of TEACHER.curve) {
      const row = within(table).getByRole("row", { name: new RegExp(`^${c.iteration}`) });
      expect(row.textContent).toContain(`${c.withDemos}/${TEACHER.n}`);
      expect(row.textContent).toContain(`${c.withoutDemos}/${TEACHER.n}`);
    }
  });

  it("shows the speed gate before and after the cap, from proofData", () => {
    renderWorld();
    const gate = beats()[3];
    const { before, after, passMark } = TEACHER_GATE;
    expect(gate.textContent).toContain(`${before.k}/${before.n}`);
    expect(gate.textContent).toContain(`${after.k}/${after.n}`);
    expect(gate.textContent).toContain(`${before.speed} m/s`);
    expect(gate.textContent).toContain(`${after.speed} m/s`);
    expect(gate.textContent).toContain(`${passMark.k}/${passMark.n}`);
    const rows = gate.querySelectorAll(".intro-pbeat__tally");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('[data-pass="true"]')).toHaveLength(before.k);
    expect(rows[1].querySelectorAll('[data-pass="true"]')).toHaveLength(after.k);
  });

  it("draws each graph with the scroll: part way, part drawn; in the hold, whole; back up, undrawn again", () => {
    renderWorld();
    // The pipeline lights step by step.
    const lit = () => beats()[0].querySelectorAll('li[data-lit="true"]').length;
    scrollToBeat(0, 0.1 + (PROOF_DRAWN - 0.1) * 0.5);
    expect(lit()).toBeGreaterThan(0);
    expect(lit()).toBeLessThan(5);
    scrollToBeat(0, HOLD);
    expect(lit()).toBe(5);
    // The climb's bars grow in order.
    const bars = () => [...beats()[1].querySelectorAll<HTMLElement>(".intro-pbeat__bar")].map(scaleOf);
    scrollToBeat(1, 0.1 + (PROOF_DRAWN - 0.1) * 0.3);
    const mid = bars();
    // (The raw bar is 0/40 whatever the draw.) SANT's is on its way, v2's not started.
    expect(mid[1]).toBeGreaterThan(0);
    expect(mid[1]).toBeLessThan(CLIMB[1].k / CLIMB[1].n);
    expect(mid[3]).toBe(0);
    scrollToBeat(1, HOLD);
    bars().forEach((v, i) => expect(v).toBeCloseTo(CLIMB[i].k / CLIMB[i].n, 6));
    scrollToBeat(1, 0.12);
    expect(bars()[3]).toBe(0);
    // The teacher curve: the readout names the last checkpoint reached.
    const readout = () => beats()[2].querySelector<HTMLElement>(".intro-pbeat__readout")!.textContent;
    scrollToBeat(2, 0.1 + (PROOF_DRAWN - 0.1) * 0.55);
    expect(readout()).toMatch(/Iteration (600|900)/);
    scrollToBeat(2, HOLD);
    expect(readout()).toContain(`Iteration ${TEACHER.curve[TEACHER.curve.length - 1].iteration}`);
    expect(readout()).toContain(`${TEACHER.final.withDemos.k}/${TEACHER.n}`);
    // The gate's tallies fill, the uncapped row first.
    const on = (r: number) => beats()[3].querySelectorAll(".intro-pbeat__tally")[r].querySelectorAll('[data-on="true"]').length;
    scrollToBeat(3, 0.1 + (PROOF_DRAWN - 0.1) * 0.3);
    expect(on(0)).toBeGreaterThan(0);
    expect(on(1)).toBe(0);
    scrollToBeat(3, HOLD);
    expect([on(0), on(1)]).toEqual([TEACHER_GATE.before.n, TEACHER_GATE.after.n]);
  });

  it("with reduced motion, shows each graph whole as soon as its beat shows", () => {
    localStorage.setItem("sant.effects", "off");
    renderWorld();
    // Just in: the graph would not have started drawing yet.
    scrollToBeat(1, 0.09);
    expect(parseFloat(beats()[1].style.opacity)).toBeGreaterThan(0);
    [...beats()[1].querySelectorAll<HTMLElement>(".intro-pbeat__bar")].forEach((b, i) => expect(scaleOf(b)).toBeCloseTo(CLIMB[i].k / CLIMB[i].n, 6));
    scrollToBeat(0, 0.09);
    expect(beats()[0].querySelectorAll('li[data-lit="true"]')).toHaveLength(5);
    scrollToBeat(3, 0.09);
    expect(beats()[3].querySelectorAll('[data-on="true"]')).toHaveLength(TEACHER_GATE.before.n + TEACHER_GATE.after.n);
    scrollToBeat(2, 0.09);
    expect(beats()[2].querySelector(".intro-pbeat__readout")!.textContent).toContain(`${TEACHER.final.withDemos.k}/${TEACHER.n}`);
  });

  it("can be reached by Tab: focusing a beat brings the story to it", () => {
    renderWorld();
    const h = window.innerHeight;
    for (let i = 0; i < PROOF_BEATS; i++) {
      vi.mocked(window.scrollTo).mockClear();
      act(() => beats()[i].focus());
      expect(document.activeElement).toBe(beats()[i]);
      const [a, b] = proofBeatSpan(i);
      const y = Math.max(...ys());
      expect(y).toBeGreaterThan(h * (a + (b - a) * PROOF_DRAWN));
      expect(y).toBeLessThan(h * (a + (b - a) * 0.88));
      // The scroll lands there: the beat is the one on screen.
      scrollTo(y);
      expect(shownBeats()).toEqual([i]);
    }
  });

  it("links to the real test runs and to every number with its source", () => {
    renderWorld();
    const climb = beats()[1];
    expect(within(climb).getByRole("link", { name: /Watch the real test runs/ }).getAttribute("href")).toBe("/test-track");
    expect(within(climb).getByRole("link", { name: /sources/i }).getAttribute("href")).toBe("/site/results#proof");
  });

  it("keeps the journey right: Skip the intro, the rail's Descent, a reload mid-proof", async () => {
    const h = window.innerHeight;
    const { unmount } = renderWorld();
    // The rail's Descent lands past the proof.
    scrollToBeat(1, HOLD);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Journey" })).getByRole("button", { name: "Descent" }));
    await waitFor(() => expect(ys()).toContain(h * INTRO_VH));
    scrollTo(h * INTRO_VH);
    expect(current()).toBe("descent");
    expect(shownBeats()).toEqual([]);
    // A reload in the middle of the climb comes back to the climb.
    scrollToBeat(1, HOLD);
    const y = window.scrollY;
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    unmount();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.mocked(window.scrollTo).mockClear();
    vi.spyOn(performance, "getEntriesByType").mockImplementation(((t: string) => (t === "navigation" ? [{ type: "reload" }] : [])) as never);
    renderWorld();
    expect(Math.abs(Math.max(...ys()) - y)).toBeLessThan(2);
    expect(shownBeats()).toEqual([1]);
    // Skip the intro still lands in the room.
    fireEvent.click(screen.getByRole("link", { name: "Skip the intro" }));
    expect(current()).toBe("workshop");
    expect(shownBeats()).toEqual([]);
  });
});

describe("a beat's sources line", () => {
  it("names each note once, its lines in order, none already inside a cited range", () => {
    expect(
      sourcesLine([
        { note: "distill", lines: "440" },
        { note: "bigtest", lines: "765" },
        { note: "distill", lines: "439–441, 451" },
        { note: "bigtest", lines: "744, 757–758" },
      ]),
    ).toBe("Distill pre-registration note, lines 439–441, 451 · Big-test pre-registration note, lines 744, 757–758, 765");
  });
});
