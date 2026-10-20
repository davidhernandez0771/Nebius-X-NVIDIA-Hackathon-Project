import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { WorldContext, type WorldApi } from "../../core/WorldContext";
import { robotsView } from "./hot";
import { Panel } from "./Panel";

function at(current = true) {
  const api = { back: vi.fn() } as unknown as WorldApi;
  render(
    <WorldContext.Provider value={api}>
      <Panel current={current} reduced={false} />
    </WorldContext.Provider>,
  );
  return api;
}

afterEach(() => {
  cleanup();
  robotsView.reset();
});

const entry = (name: string) => screen.getByRole("article", { name });

describe("the robots catalog panel", () => {
  it("lists the five robots with their status, honestly: tested in Isaac or planned", () => {
    at();
    expect(screen.getByRole("heading", { level: 2, name: "The robots" })).toBeTruthy();
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Franka Panda", "Flexiv Rizon 4s", "OpenArm", "SO-101", "PiPER"]);
    expect(within(entry("Franka Panda")).getByText("Tested in Isaac")).toBeTruthy();
    expect(within(entry("OpenArm")).getByText("Tested in Isaac")).toBeTruthy();
    expect(within(entry("SO-101")).getByText("Planned")).toBeTruthy();
    expect(within(entry("PiPER")).getByText("Planned")).toBeTruthy();
  });

  it("shows what the repo has and leaves the rest out", () => {
    at();
    const franka = within(entry("Franka Panda"));
    expect(franka.getByText("Franka Emika")).toBeTruthy();
    expect(franka.getByText("0.86 m")).toBeTruthy();
    expect(franka.getByText("Joint limits")).toBeTruthy();
    expect(franka.getByText("-176° to -4°")).toBeTruthy();
    expect(franka.getByText(/^Multiply 30\/30/)).toBeTruthy();
    expect(within(entry("Flexiv Rizon 4s")).queryByText("Joint limits")).toBeNull();
    expect(within(entry("SO-101")).queryByText("In Isaac")).toBeNull();
    expect(screen.queryByText("Payload")).toBeNull();
  });

  it("says which wall models are real meshes and which are stand-ins", () => {
    at();
    expect(screen.getByText(/stand-ins/)).toBeTruthy();
  });

  it("highlights a robot on the wall while its entry is hovered or focused", () => {
    at();
    const btn = within(entry("PiPER")).getByRole("button", { name: /PiPER/ });
    fireEvent.mouseEnter(btn);
    expect(robotsView.get().hot).toBe("piper");
    fireEvent.mouseLeave(btn);
    expect(robotsView.get().hot).toBeNull();
    fireEvent.focus(btn);
    expect(robotsView.get().hot).toBe("piper");
    fireEvent.blur(btn);
    expect(robotsView.get().hot).toBeNull();
  });

  it("brings a robot picked on the wall into view and focus", () => {
    at();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    act(() => robotsView.pick("flexiv"));
    expect(document.activeElement).toBe(within(entry("Flexiv Rizon 4s")).getByRole("button", { name: /Flexiv/ }));
    expect(scroll).toHaveBeenCalled();
  });

  it("goes back to the room", () => {
    const api = at();
    fireEvent.click(screen.getByRole("button", { name: "← Room" }));
    expect(api.back).toHaveBeenCalled();
  });
});
