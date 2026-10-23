// Letting go of the held shot (the journey rail, a branch opening, ↑ Story) ends the shelf, the detail
// view and the tour with it, so none is left listening: before, the wheel kept stepping a shelf that was
// no longer shown and the camera stayed on it over the story.
import { afterEach, describe, expect, it } from "vitest";
import { createWorldStore } from "../../core/store";
import { setSelected, spiral } from "../../scene/spiral";
import { STATIONS } from "..";
import { followRelease, scrollToStep, shelf } from "./stepper";
import { startTour, tourStep } from "./tour";

const setup = () => {
  const store = createWorldStore(STATIONS, 800, 0);
  const off = followRelease(store);
  return { store, off };
};

describe("letting go of the held shot", () => {
  afterEach(() => {
    shelf.open = false;
    setSelected(-1);
  });

  it("closes the shelf and a detail view when the page lets go of their shot", () => {
    const { store, off } = setup();
    scrollToStep(store, 2);
    setSelected(2);
    expect(shelf.open).toBe(true);
    store.setOverride(null);
    expect(shelf.open).toBe(false);
    expect(spiral.selected).toBe(-1);
    off();
  });

  it("ends the tour too", () => {
    const { store, off } = setup();
    startTour(store);
    expect(tourStep()).toBe(0);
    store.setOverride(null);
    expect(tourStep()).toBe(-1);
    off();
  });

  it("leaves the shelf alone while its shot (or the detail's on top of it) is held", () => {
    const { store, off } = setup();
    scrollToStep(store, 1);
    store.setOverride({ position: [0, 1, 2], target: [0, 0, 0], fov: 40 });
    expect(shelf.open).toBe(true);
    off();
  });
});
