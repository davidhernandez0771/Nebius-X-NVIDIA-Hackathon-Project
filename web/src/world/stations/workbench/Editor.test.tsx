// The workbench without WebGL (as the stills fallback runs it): name a cartridge, pick its look and
// robot, save it to the spiral (localStorage), remove it, and go back to the room view.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../../sant";
import WorldRoot from "../../core/WorldRoot";
import { INTRO_VH } from "../intro/storyline";
import { MAX_SAVED, STORAGE_KEY, resetSaved, saveCartridge } from "../../scene/saved";
import { bench, resetBench } from "./draft";

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

const current = () => document.querySelector<HTMLElement>('.world-station[data-current="true"]')?.dataset.station;

function openBench() {
  renderWorld();
  act(() => {
    Object.defineProperty(window, "scrollY", { value: window.innerHeight * (INTRO_VH + 3.8), configurable: true });
    window.dispatchEvent(new Event("scroll"));
  });
  fireEvent.click(screen.getByRole("button", { name: "+ Add a cartridge" }));
  expect(current()).toBe("workbench");
  return document.querySelector<HTMLElement>('.world-station[data-station="workbench"]')!;
}

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as { name: string; shell: string; robot: string }[];

describe("the workbench editor", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    sessionStorage.clear();
    localStorage.clear();
    resetSaved();
    resetBench();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("names a cartridge, picks its look and robot, and saves it to the spiral", () => {
    const at = within(openBench());
    fireEvent.change(at.getByLabelText(/name/i), { target: { value: "Kitchen arm" } });
    fireEvent.click(at.getByRole("button", { name: "Signal" }));
    fireEvent.click(at.getByRole("button", { name: "Franka FR3" }));
    // The cartridge on the bench follows the draft.
    expect(bench.draft).toEqual({ name: "Kitchen arm", shell: "signal", robot: "FR3" });
    expect(at.getByRole("button", { name: "Signal" }).getAttribute("aria-pressed")).toBe("true");
    expect(at.getByText("Franka FR3 · 7-DOF · research arm")).toBeTruthy();

    fireEvent.click(at.getByRole("button", { name: "Save to the spiral →" }));
    expect(stored()).toMatchObject([{ name: "Kitchen arm", shell: "signal", robot: "FR3" }]);
    expect(at.getByRole("status").textContent).toBe(`Saved. KITCHEN ARM is on the spiral, place 1 of ${MAX_SAVED}.`);
    // The printer printed its label, and the bench is ready for the next one.
    expect(bench.printed?.code).toBe("KITCHEN ARM");
    expect(bench.draft.name).toBe("");
    expect(at.getByText("Kitchen arm")).toBeTruthy();
  });

  it("saves on Enter in the name, and asks for a name first", () => {
    const at = within(openBench());
    const input = at.getByLabelText(/name/i);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(at.getByRole("status").textContent).toBe("Name it first.");
    expect(stored()).toEqual([]);
    fireEvent.change(input, { target: { value: "Desk arm" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(stored().map((c) => c.name)).toEqual(["Desk arm"]);
  });

  it("says when the spiral is full, and frees a place on remove", () => {
    for (let i = 0; i < MAX_SAVED; i++) saveCartridge({ name: `arm ${i}`, shell: "bone", robot: "S101" });
    const at = within(openBench());
    fireEvent.change(at.getByLabelText(/name/i), { target: { value: "one more" } });
    fireEvent.click(at.getByRole("button", { name: "Spiral full" }));
    expect(at.getByRole("status").textContent).toMatch(/full/);
    expect(stored()).toHaveLength(MAX_SAVED);
    fireEvent.click(at.getByRole("button", { name: "Remove arm 0 from the spiral" }));
    expect(stored().map((c) => c.name)).toEqual(["arm 1", "arm 2", "arm 3"]);
    fireEvent.click(at.getByRole("button", { name: "Save to the spiral →" }));
    expect(stored().map((c) => c.name)).toEqual(["arm 1", "arm 2", "arm 3", "one more"]);
  });

  it("goes back to the room view with Back, and keeps the draft for next time", () => {
    const at = within(openBench());
    fireEvent.change(at.getByLabelText(/name/i), { target: { value: "half done" } });
    fireEvent.click(at.getByRole("button", { name: "← Back" }));
    expect(current()).toBe("workshop");
    expect(bench.draft.name).toBe("half done");
  });
});
