// The workbench without WebGL (as the stills fallback runs it): build a cartridge in five stages (a
// shell, a colour, a robot, a name, done), save it to the spiral (localStorage), remove one, and go back
// to the room view.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../../../sant";
import WorldRoot from "../../core/WorldRoot";
import { INTRO_VH } from "../intro/storyPlan";
import { MAX_SAVED, STORAGE_KEY, finishOf, resetSaved, saveCartridge } from "../../scene/saved";
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
  return within(document.querySelector<HTMLElement>('.world-station[data-station="workbench"]')!);
}

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as { name: string; finish: string; color: string; robot: string }[];
type At = ReturnType<typeof openBench>;
const next = (at: At) => fireEvent.click(at.getByRole("button", { name: /^Next/ }));
const stageNow = (at: At) => at.getByRole("listitem", { current: "step" }).textContent;

/** Through the first three stages with a shell, a colour and a robot. */
function toName(at: At, shell = "Carbon", colour = "Bone", robot = "Franka FR3") {
  fireEvent.click(at.getByRole("radio", { name: shell }));
  next(at);
  fireEvent.click(at.getByRole("radio", { name: colour }));
  next(at);
  fireEvent.click(at.getByRole("radio", { name: robot }));
  next(at);
}

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

  it("opens on the first of five stages, with the six shells to pick from", () => {
    const at = openBench();
    const steps = at.getByRole("list", { name: "Steps" });
    expect(within(steps).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["01Material", "02Colour", "03Robot", "04Name", "05Done"]);
    expect(stageNow(at)).toBe("01Material");
    const shells = within(at.getByRole("radiogroup", { name: "Shell" })).getAllByRole("radio");
    expect(shells.map((r) => r.getAttribute("aria-label") ?? (r as HTMLInputElement).labels?.[0]?.textContent)).toHaveLength(6);
    expect(shells.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });

  it("asks for a shell before going on, then builds a cartridge stage by stage and saves it", () => {
    const at = openBench();
    next(at);
    expect(at.getByRole("status").textContent).toBe("Pick a shell first.");
    expect(stageNow(at)).toBe("01Material");

    fireEvent.click(at.getByRole("radio", { name: "Carbon" }));
    expect(bench.draft.finish).toBe("carbon");
    expect(bench.draft.color).toBe(finishOf("carbon").color);
    next(at);
    expect(stageNow(at)).toBe("02Colour");
    // The stage's heading takes the focus, so a screen reader says where it is.
    expect(document.activeElement?.textContent).toMatch(/Colour/);

    fireEvent.click(at.getByRole("radio", { name: "Bone" }));
    expect(bench.draft.color).toBe("#e2ddd0");
    fireEvent.input(at.getByLabelText("Any colour"), { target: { value: "#ff8800" } });
    expect(bench.draft.color).toBe("#ff8800");
    next(at);

    expect(stageNow(at)).toBe("03Robot");
    fireEvent.click(at.getByRole("radio", { name: "Franka FR3" }));
    expect(at.getByText("Franka FR3 · 7-DOF · research arm")).toBeTruthy();
    next(at);

    expect(stageNow(at)).toBe("04Name");
    fireEvent.change(at.getByLabelText("Name"), { target: { value: "Kitchen arm" } });
    fireEvent.click(at.getByRole("button", { name: "Finish ✓" }));

    expect(stored()).toMatchObject([{ name: "Kitchen arm", finish: "carbon", color: "#ff8800", robot: "FR3" }]);
    expect(stageNow(at)).toBe("05Done");
    expect(at.getByRole("status").textContent).toBe(`KITCHEN ARM is on the spiral, place 1 of ${MAX_SAVED}.`);
    // The printer printed its label, and the cartridge is flying to its place.
    expect(bench.printed?.code).toBe("KITCHEN ARM");
    expect(bench.landing).toBe(0);
  });

  it("makes another from the done stage: a fresh bench at the first stage", () => {
    const at = openBench();
    toName(at);
    fireEvent.change(at.getByLabelText("Name"), { target: { value: "first" } });
    fireEvent.click(at.getByRole("button", { name: "Finish ✓" }));
    fireEvent.click(at.getByRole("button", { name: "Make another" }));
    expect(stageNow(at)).toBe("01Material");
    expect(bench.draft.finish).toBeNull();
    expect(bench.draft.name).toBe("");
  });

  it("goes back a stage with Back, and leaves for the room from the first", () => {
    const at = openBench();
    toName(at);
    fireEvent.click(at.getByRole("button", { name: "← Back" }));
    expect(stageNow(at)).toBe("03Robot");
    fireEvent.click(at.getByRole("button", { name: "← Back" }));
    fireEvent.click(at.getByRole("button", { name: "← Back" }));
    expect(stageNow(at)).toBe("01Material");
    fireEvent.click(at.getByRole("button", { name: "← Room" }));
    expect(current()).toBe("workshop");
  });

  it("saves on Enter in the name, and asks for a name first", () => {
    const at = openBench();
    toName(at);
    const input = at.getByLabelText("Name");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(at.getByRole("status").textContent).toBe("Name it first.");
    expect(stored()).toEqual([]);
    fireEvent.change(input, { target: { value: "Desk arm" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(stored().map((c) => c.name)).toEqual(["Desk arm"]);
  });

  it("says when the spiral is full, and frees a place on remove", () => {
    for (let i = 0; i < MAX_SAVED; i++) saveCartridge({ name: `arm ${i}`, finish: "matte", color: "#e2ddd0", robot: "S101" });
    const at = openBench();
    expect(at.getByText(/The spiral is full/)).toBeTruthy();
    toName(at);
    fireEvent.change(at.getByLabelText("Name"), { target: { value: "one more" } });
    fireEvent.click(at.getByRole("button", { name: "Finish ✓" }));
    expect(at.getByRole("status").textContent).toMatch(/full/);
    expect(stored()).toHaveLength(MAX_SAVED);
    // Back to the first stage, where the spiral's list is, to free a place.
    for (let i = 0; i < 3; i++) fireEvent.click(at.getByRole("button", { name: "← Back" }));
    fireEvent.click(at.getByRole("button", { name: "Remove arm 0 from the spiral" }));
    expect(stored().map((c) => c.name)).toEqual(["arm 1", "arm 2", "arm 3"]);
    for (let i = 0; i < 3; i++) next(at);
    fireEvent.click(at.getByRole("button", { name: "Finish ✓" }));
    expect(stored().map((c) => c.name)).toEqual(["arm 1", "arm 2", "arm 3", "one more"]);
  });

  it("lands a cartridge still flying when the bench closes", () => {
    saveCartridge({ name: "first", finish: "matte", color: "#e2ddd0", robot: "S101" });
    const at = openBench();
    toName(at);
    fireEvent.change(at.getByLabelText("Name"), { target: { value: "second" } });
    fireEvent.click(at.getByRole("button", { name: "Finish ✓" }));
    expect(bench.landing).toBe(1);
    fireEvent.click(at.getByRole("button", { name: "Back to the room" }));
    expect(bench.landing).toBe(-1);
    expect(current()).toBe("workshop");
  });

  // The spiral's saved cartridges can be pointed at in 3D; the keyboard (and the stills) reach them
  // through the dock, beside the robots.
  it("gives each saved cartridge a button in the dock that plugs it into the machine", () => {
    saveCartridge({ name: "Kitchen arm", finish: "gloss", color: "#2bb39a", robot: "FR3" });
    const at = openBench();
    fireEvent.click(at.getByRole("button", { name: "← Room" }));
    const robots = within(screen.getByRole("group", { name: "Robots" }));
    fireEvent.click(robots.getByRole("button", { name: "Kitchen arm" }));
    expect(current()).toBe("machine");
    expect(document.querySelector('.world-station[data-station="machine"]')?.textContent).toContain("Kitchen arm plugs in");
  });

  it("keeps the draft and its stage for next time; a finished one starts fresh", () => {
    let at = openBench();
    toName(at);
    fireEvent.change(at.getByLabelText("Name"), { target: { value: "half done" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(current()).toBe("workshop");
    expect(bench.draft.name).toBe("half done");
    cleanup();
    at = openBench();
    expect(stageNow(at)).toBe("04Name");
    fireEvent.click(at.getByRole("button", { name: "Finish ✓" }));
    fireEvent.click(at.getByRole("button", { name: "Back to the room" }));
    cleanup();
    at = openBench();
    expect(stageNow(at)).toBe("01Material");
  });
});
