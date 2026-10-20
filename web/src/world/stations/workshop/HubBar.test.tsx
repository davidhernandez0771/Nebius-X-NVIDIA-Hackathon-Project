import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { WorldContext, type WorldApi } from "../../core/WorldContext";
import type { WorldStore } from "../../core/store";
import { HubBar } from "./HubBar";

const stepper = vi.hoisted(() => ({ scrollToStep: vi.fn() }));
vi.mock("./stepper", () => stepper);

function at() {
  const store = { onFrame: () => () => {}, setOverride: vi.fn() } as unknown as WorldStore;
  const api = { store, goTo: vi.fn() } as unknown as WorldApi;
  const story = vi.fn();
  window.addEventListener("world:story", story);
  render(
    <WorldContext.Provider value={api}>
      <HubBar />
    </WorldContext.Provider>,
  );
  return { api, store, story, off: () => window.removeEventListener("world:story", story) };
}

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

  // On a phone held upright the room view's camera only frames the shelf: the machine's and the
  // bench's tags are off the sides, so the bar carries the three as buttons too (shown by CSS there).
  it("opens the shelf, the machine and the bench without their tags", () => {
    const { api, store } = at();
    const go = within(screen.getByRole("group", { name: "Go to" }));
    fireEvent.click(go.getByRole("button", { name: "Shelf" }));
    expect(stepper.scrollToStep).toHaveBeenCalledWith(store, 0);
    fireEvent.click(go.getByRole("button", { name: "Machine" }));
    expect(api.goTo).toHaveBeenCalledWith("machine");
    fireEvent.click(go.getByRole("button", { name: "Bench" }));
    expect(api.goTo).toHaveBeenCalledWith("workbench");
  });
});
