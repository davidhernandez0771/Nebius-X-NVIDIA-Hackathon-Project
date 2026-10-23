import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { WorldContext, type WorldApi } from "../../core/WorldContext";
import { TIERS } from "../../core/quality";
import { robotsView } from "./hot";
import { Panel } from "./Panel";

function at(current = true, tier: "low" | "high" = "high") {
  const api = { back: vi.fn(), quality: TIERS[tier] } as unknown as WorldApi;
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

  it("says the wall's robots are their makers' published meshes, with each one's licence, and the Flexiv a stand-in", () => {
    at();
    expect(screen.getByText(/makers' published CAD meshes/)).toBeTruthy();
    const has = (s: string) => (text: string) => text.includes(s);
    expect(within(entry("Franka Panda")).getByText(has("franka_description@7aeeddc, Apache-2.0"))).toBeTruthy();
    expect(within(entry("PiPER")).getByText(has("MIT (its package.xml says BSD)"))).toBeTruthy();
    expect(within(entry("Flexiv Rizon 4s")).getByText(/^A simple stand-in/)).toBeTruthy();
  });

  it("lists the arms on the right wall that SANT hasn't run, except on the low tier, which leaves them off the wall", () => {
    at();
    const also = screen.getByRole("region", { name: "Also on the wall" });
    expect(within(also).getAllByRole("listitem").map((li) => li.querySelector("b")?.textContent)).toEqual(["Franka Research 3", "Universal Robots UR5e", "UFACTORY xArm 6 + xArm gripper"]);
    expect(within(also).getByText(/SANT hasn't run them/)).toBeTruthy();
    cleanup();
    at(true, "low");
    expect(screen.queryByRole("region", { name: "Also on the wall" })).toBeNull();
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

  it("goes back to the room with a real button, and says how", () => {
    const api = at();
    fireEvent.click(screen.getByRole("button", { name: "Back to room" }));
    expect(api.back).toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "The robot wall: the way out" }).textContent).toMatch(/close-up/);
  });

  it("gives a robot a close-up from its entry too (the keyboard path to the wall), and steps back to the wall", () => {
    at();
    Element.prototype.scrollIntoView = vi.fn();
    fireEvent.click(within(entry("OpenArm")).getByRole("button", { name: /OpenArm/ }));
    expect(robotsView.get().picked).toBe("openarm");
    fireEvent.click(screen.getByRole("button", { name: "All robots" }));
    expect(robotsView.get().picked).toBeNull();
  });

  it("Escape in a close-up steps back to the wall, and takes the key so the room stays open", () => {
    at();
    Element.prototype.scrollIntoView = vi.fn();
    act(() => robotsView.pick("so101"));
    const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    act(() => void window.dispatchEvent(e));
    expect(robotsView.get().picked).toBeNull();
    expect(e.defaultPrevented).toBe(true);
    // On the wall, Escape belongs to WorldRoot (back to the room): the panel leaves it alone.
    const e2 = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    act(() => void window.dispatchEvent(e2));
    expect(e2.defaultPrevented).toBe(false);
  });

  it("closing the wall drops the close-up", () => {
    robotsView.pick("piper");
    at(false);
    expect(robotsView.get().picked).toBeNull();
  });
});
