import { afterEach, describe, expect, it, vi } from "vitest";
import { hotNumber, robotsView } from "./hot";

afterEach(() => robotsView.reset());

describe("the robots view's highlight", () => {
  it("holds the robot under the pointer or the focus, and tells who listens", () => {
    const seen = vi.fn();
    const off = robotsView.subscribe(seen);
    robotsView.setHot("flexiv");
    expect(robotsView.get().hot).toBe("flexiv");
    expect(seen).toHaveBeenCalledTimes(1);
    robotsView.setHot("flexiv");
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    robotsView.setHot(null);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("asks the panel to show a robot picked on the wall", () => {
    robotsView.pick("piper");
    expect(robotsView.get()).toMatchObject({ hot: "piper", picked: "piper" });
    // A new pick of the same robot still counts (the panel scrolls to it again).
    const before = robotsView.get().pickCount;
    robotsView.pick("piper");
    expect(robotsView.get().pickCount).toBe(before + 1);
  });

  it("numbers the hot robot as the wall's shader does (catalog order, 1-based; 0 for none)", () => {
    expect(hotNumber(null)).toBe(0);
    expect(hotNumber("franka")).toBe(1);
    expect(hotNumber("piper")).toBe(5);
  });
});
