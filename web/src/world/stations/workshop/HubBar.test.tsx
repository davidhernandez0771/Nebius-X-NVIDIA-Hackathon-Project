import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { WorldContext, type WorldApi } from "../../core/WorldContext";
import type { WorldStore } from "../../core/store";
import { HubBar } from "./HubBar";
import { HUB_TAGS, openHubItem } from "./hubItems";

const stepper = vi.hoisted(() => ({ scrollToStep: vi.fn() }));
vi.mock("./stepper", () => stepper);

// Vitest blanks CSS imports (even `?raw`): read the stylesheet itself (sant/tokens.test.ts does the same).
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(path: string, encoding: "utf-8"): string };
const css = fs.readFileSync("src/world/stations/workshop/workshop.css", "utf-8");

const rig = vi.hoisted(() => ({ hub: false }));
vi.mock("../../core/CameraRig", () => ({ inHub: () => rig.hub }));

function at(mode: "3d" | "stills" = "3d") {
  const frames: (() => void)[] = [];
  const store = { onFrame: (fn: () => void) => (frames.push(fn), () => {}), setOverride: vi.fn() } as unknown as WorldStore;
  const api = { store, goTo: vi.fn(), mode } as unknown as WorldApi;
  const story = vi.fn();
  window.addEventListener("world:story", story);
  render(
    <WorldContext.Provider value={api}>
      <HubBar />
    </WorldContext.Provider>,
  );
  const frame = () => act(() => frames.forEach((f) => f()));
  return { api, store, story, frame, off: () => window.removeEventListener("world:story", story) };
}

// The room view, unless a test says otherwise.
beforeEach(() => {
  rig.hub = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the room view's bar", () => {
  it("goes back up to the story", () => {
    const { store, story, off } = at();
    fireEvent.click(screen.getByRole("button", { name: "↑ Story" }));
    expect(store.setOverride).toHaveBeenCalledWith(null);
    expect(story).toHaveBeenCalled();
    off();
  });

  // site bug hunt (2026-10-26): without the canvas (the stills) the tags are only drawn into the picture and do
  // nothing, yet the bar said "Click a tag to go in" and hid its place buttons above phone width.
  it("in the 2D fallback, says to pick a place and shows the place buttons at every width", () => {
    at("stills");
    const bar = document.querySelector<HTMLElement>(".world-hubbar")!;
    expect(bar.dataset.flat).toBe("true");
    expect(bar.textContent).not.toMatch(/Click a tag/);
    expect(bar.textContent).toMatch(/Pick a place/);
    expect(within(screen.getByRole("group", { name: "Go to" })).getAllByRole("button")).toHaveLength(5);
    // The stylesheet shows them there (jsdom has no layout: the rule itself is checked).
    expect(css.replace(/\s+/g, " ")).toMatch(/\.world-hubbar\[data-flat="true"\] \.world-hubbar__go \{ display: flex; \}/);
  });

  it("in 3D, keeps the tags' hint and leaves the buttons to phones", () => {
    at("3d");
    const bar = document.querySelector<HTMLElement>(".world-hubbar")!;
    expect(bar.dataset.flat).toBe("false");
    expect(bar.textContent).toMatch(/Click a tag to go in/);
  });

  // site bug hunt: hidden (opacity 0) outside the room view, "↑ Story" and the place buttons stayed in the Tab order.
  it("is out of the Tab order and the accessibility tree while it is hidden, back in the room view", () => {
    rig.hub = false;
    const { frame } = at();
    const bar = document.querySelector<HTMLElement>(".world-hubbar")!;
    frame();
    expect(bar.hasAttribute("inert")).toBe(true);
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    rig.hub = true;
    frame();
    expect(bar.dataset.on).toBe("true");
    expect(bar.hasAttribute("inert")).toBe(false);
    expect(bar.hasAttribute("aria-hidden")).toBe(false);
    rig.hub = false;
    frame();
    expect(bar.hasAttribute("inert")).toBe(true);
  });

  // proof-wall (2026-10-26): the proof wall is the fifth thing to click, its tag "05 The proof".
  it("opens the proof wall from its hub tag's entry, as a place (#proof)", () => {
    const goTo = vi.fn();
    openHubItem("proof", {} as WorldStore, goTo);
    expect(goTo).toHaveBeenCalledWith("proof");
    expect(HUB_TAGS.map((t) => `${t.n} ${t.title}`)).toEqual(["01 The shelf", "02 The machine", "03 The bench", "04 The wall", "05 The proof"]);
    expect(HUB_TAGS[4].line).toMatch(/30\/40/);
  });

  // On a phone held upright the room view's camera only frames the shelf: the machine's and the
  // bench's tags are off the sides, so the bar carries the three as buttons too (shown by CSS there).
  it("opens the shelf, the machine, the bench and the robot wall without their tags", () => {
    const { api, store } = at();
    const go = within(screen.getByRole("group", { name: "Go to" }));
    fireEvent.click(go.getByRole("button", { name: "Shelf" }));
    expect(stepper.scrollToStep).toHaveBeenCalledWith(store, 0);
    fireEvent.click(go.getByRole("button", { name: "Machine" }));
    expect(api.goTo).toHaveBeenCalledWith("machine");
    fireEvent.click(go.getByRole("button", { name: "Bench" }));
    expect(api.goTo).toHaveBeenCalledWith("workbench");
    fireEvent.click(go.getByRole("button", { name: "Robots" }));
    expect(api.goTo).toHaveBeenCalledWith("robots");
    fireEvent.click(go.getByRole("button", { name: "Proof" }));
    expect(api.goTo).toHaveBeenCalledWith("proof");
  });

  it("names all five things to click, in the room's Tab order", () => {
    at();
    expect(within(screen.getByRole("group", { name: "Go to" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Shelf", "Machine", "Bench", "Robots", "Proof"]);
  });
});
