import { describe, expect, it, vi } from "vitest";
import { STATIONS } from "../stations";
import { createWorldStore } from "./store";

const VH = 1000;

describe("createWorldStore", () => {
  it("lays out the rail stations in RAIL_ORDER and sizes the page", () => {
    const s = createWorldStore(STATIONS, VH);
    expect(s.rails.map((r) => r.id)).toEqual(["story", "descent", "workshop", "machine", "zoom"]);
    expect(s.getCoarse().height).toBe(s.rail.total + VH);
    expect(s.getCoarse().current).toBe("story");
  });

  it("notifies React only when the station changes, not on every scroll", () => {
    const s = createWorldStore(STATIONS, VH);
    const fn = vi.fn();
    s.subscribe(fn);
    s.setScroll(100);
    s.setScroll(200);
    expect(fn).not.toHaveBeenCalled();
    const workshop = s.rail.spans.find((x) => x.id === "workshop")!;
    s.setScroll(workshop.start + 10);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.getCoarse().current).toBe("workshop");
  });

  it("updates frames in place for the shown position and tells frame listeners", () => {
    const s = createWorldStore(STATIONS, VH);
    const machine = s.frames.machine;
    const onFrame = vi.fn();
    s.onFrame(onFrame);
    const span = s.rail.spans.find((x) => x.id === "machine")!;
    s.setShown((span.start + span.end) / 2);
    expect(s.frames.machine).toBe(machine);
    expect(machine.t).toBeCloseTo(0.5, 6);
    expect(machine.current).toBe(true);
    expect(s.frames.story.near).toBe(false);
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("opens a branch: it becomes current and no rail station is", () => {
    const s = createWorldStore(STATIONS, VH);
    s.setBranch("workbench");
    expect(s.getCoarse().branch).toBe("workbench");
    expect(s.frames.workbench.current).toBe(true);
    expect(s.frames.story.current).toBe(false);
    s.setBranch(null);
    expect(s.frames.story.current).toBe(true);
  });

  it("keeps the place on the rail when the viewport resizes", () => {
    const s = createWorldStore(STATIONS, VH);
    const span = s.rail.spans.find((x) => x.id === "workshop")!;
    s.setScroll(span.start);
    s.setViewport(500);
    expect(s.targetY).toBe(span.start / 2);
    expect(s.getCoarse().height).toBe(s.rail.total + 500);
  });

  it("asks the canvas for a frame on scroll, branch and cartridge changes", () => {
    const s = createWorldStore(STATIONS, VH);
    const onTarget = vi.fn();
    s.onTarget(onTarget);
    s.setScroll(5);
    s.setBranch("workbench");
    s.setCartridge({ id: "review", label: "Review", route: "/pm/review" });
    expect(onTarget).toHaveBeenCalledTimes(3);
  });
});
