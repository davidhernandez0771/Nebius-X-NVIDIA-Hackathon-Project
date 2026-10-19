import { describe, expect, it } from "vitest";
import { createWorldStore } from "../../core/store";
import { STATIONS } from "..";
import { stepView } from "./camera";
import { closeShelf, nextStep, scrollToStep, shelf, shelfView } from "./stepper";

describe("the shelf (the spiral browsed in place)", () => {
  it("moves exactly one cartridge per step and stops at both ends", () => {
    expect(nextStep(5, 1, 23)).toBe(6);
    expect(nextStep(5, -1, 23)).toBe(4);
    expect(nextStep(0, -1, 23)).toBe(0);
    expect(nextStep(23, 1, 23)).toBe(23);
    // With a filter on, the steps end at the last match.
    expect(nextStep(3, 1, 3)).toBe(3);
  });

  it("opens on a cartridge with the camera holding the shot facing it, and closes back to the room", () => {
    const store = createWorldStore(STATIONS, 1000);
    scrollToStep(store, 4);
    expect(shelf.open).toBe(true);
    expect(shelf.step).toBe(4);
    expect(store.getCoarse().override).toEqual(stepView(4));
    expect(shelfView()).toEqual(stepView(4));
    closeShelf(store);
    expect(shelf.open).toBe(false);
    expect(store.getCoarse().override).toBeNull();
    expect(shelfView()).toBeNull();
  });

  it("never scrolls the page: the store's scroll is where it was", () => {
    const store = createWorldStore(STATIONS, 1000, 1234);
    scrollToStep(store, 7);
    expect(store.targetY).toBe(1234);
    closeShelf(store);
  });
});
