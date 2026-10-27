// One owner holds the page still: a branch, a held shot (the shelf, the detail view, the tour) or the
// room view once the dive has landed. Before, three effects each saved and restored the page's overflow
// on their own, and an old "hidden" came back after leaving the shelf: the page couldn't scroll.
import { describe, expect, it } from "vitest";
import { pageHeld } from "./pageHold";
import type { HeldShot, StationId } from "./types";

const SHOT: HeldShot = { position: [0, 1, 2], target: [0, 0, 0], fov: 40 };

const at = (current: "intro" | "descent" | "workshop", more: Partial<{ branch: StationId | null; override: HeldShot | null; ready: boolean }> = {}) => ({
  current,
  branch: null,
  override: null,
  ready: true,
  ...more,
});

describe("whether the page is held still", () => {
  it("scrolls along the story and the descent", () => {
    expect(pageHeld(at("intro"), 0, true)).toBe(false);
    expect(pageHeld(at("descent"), 0, true)).toBe(false);
  });

  it("holds in the room view once the dive has landed (3D), not on the way in", () => {
    expect(pageHeld(at("workshop"), 0.6, true)).toBe(false);
    expect(pageHeld(at("workshop"), 1, true)).toBe(true);
    // The stills have no dive to land: the workshop scrolls like the rest.
    expect(pageHeld(at("workshop"), 1, false)).toBe(false);
  });

  it("holds while a branch is open or a shot is held, 3D or stills", () => {
    for (const run3D of [true, false]) {
      expect(pageHeld(at("workshop", { branch: "machine" }), 1, run3D)).toBe(true);
      expect(pageHeld(at("workshop", { override: SHOT }), 1, run3D)).toBe(true);
    }
  });

  // The loader held the page with its own save-and-restore: when it finished with a branch already open (a
  // return from a 2D page lands in the machine), it put back the "" it saved and the branch scrolled.
  it("holds while the 3D loads, then as anything else says", () => {
    expect(pageHeld(at("intro", { ready: false }), 0, true)).toBe(true);
    expect(pageHeld(at("workshop", { ready: false, branch: "machine" }), 1, true)).toBe(true);
    expect(pageHeld(at("intro", { ready: true }), 0, true)).toBe(false);
    expect(pageHeld(at("workshop", { ready: true, branch: "machine" }), 1, true)).toBe(true);
    // The stills have nothing to load.
    expect(pageHeld(at("intro", { ready: false }), 0, false)).toBe(false);
  });

  it("lets go as soon as the journey is back on the story, whatever held it before", () => {
    expect(pageHeld(at("intro"), 1, true)).toBe(false);
  });
});
