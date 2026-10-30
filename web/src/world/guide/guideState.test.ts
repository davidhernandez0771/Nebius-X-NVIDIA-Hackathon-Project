// The guide's state: once per browser, storage that refuses, the steps, the hero's offer, the room view.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeGuide,
  declineGuide,
  guideState,
  inRoomView,
  markGuideSeen,
  nextStep,
  openGuide,
  prevStep,
  requestGuide,
  resetGuide,
  SEEN_KEY,
  seenGuide,
  showOffer,
} from "./guideState";

beforeEach(() => {
  window.localStorage.clear();
  resetGuide();
});

describe("once per browser", () => {
  it("is remembered in localStorage when it opens", () => {
    expect(seenGuide()).toBe(false);
    openGuide();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("1");
    resetGuide();
    expect(seenGuide()).toBe(true);
  });

  describe("when the storage refuses (private mode, blocked site data)", () => {
    const own = Object.getOwnPropertyDescriptor(window, "localStorage");
    beforeEach(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new Error("SecurityError");
        },
      });
    });
    afterEach(() => {
      if (own) Object.defineProperty(window, "localStorage", own);
      else delete (window as unknown as Record<string, unknown>).localStorage;
    });

    it("never throws, and remembers for this page", () => {
      expect(() => seenGuide()).not.toThrow();
      expect(seenGuide()).toBe(false);
      expect(() => markGuideSeen()).not.toThrow();
      expect(seenGuide()).toBe(true);
      expect(() => openGuide()).not.toThrow();
    });
  });
});

describe("the steps", () => {
  it("open, step on and back inside the four, and close after the last", () => {
    openGuide();
    expect(guideState().step).toBe(0);
    prevStep();
    expect(guideState().step).toBe(0);
    nextStep();
    nextStep();
    nextStep();
    expect(guideState().step).toBe(3);
    prevStep();
    expect(guideState().step).toBe(2);
    nextStep();
    nextStep();
    expect(guideState().step).toBe(-1);
  });

  it("a request waits for the room view while closed, and goes back to the first card while open", () => {
    requestGuide();
    expect(guideState()).toMatchObject({ step: -1, pending: true });
    openGuide();
    nextStep();
    requestGuide();
    expect(guideState()).toMatchObject({ step: 0, pending: false });
    closeGuide();
    expect(guideState()).toMatchObject({ step: -1, pending: false });
  });

  it("No thanks remembers it too", () => {
    declineGuide();
    expect(guideState().declined).toBe(true);
    expect(seenGuide()).toBe(true);
  });
});

describe("where it shows", () => {
  it("in the room view only: the workshop, arrived, nothing open, no held shot", () => {
    const room = { current: "workshop" as const, branch: null, override: null };
    expect(inRoomView(room, 1)).toBe(true);
    expect(inRoomView(room, 0.9)).toBe(false);
    expect(inRoomView({ ...room, current: "intro" }, 1)).toBe(false);
    expect(inRoomView({ ...room, branch: "proof" }, 1)).toBe(false);
    expect(inRoomView({ ...room, override: {} as never }, 1)).toBe(false);
  });

  it("the hero's offer: loaded, at the top of the story, a first visit, nothing else going on", () => {
    const base = { ready: true, current: "intro", scrollY: 0, vh: 800, seen: false, s: guideState() };
    expect(showOffer(base)).toBe(true);
    expect(showOffer({ ...base, ready: false })).toBe(false);
    expect(showOffer({ ...base, scrollY: 300 })).toBe(false);
    expect(showOffer({ ...base, current: "workshop" })).toBe(false);
    expect(showOffer({ ...base, seen: true })).toBe(false);
    expect(showOffer({ ...base, s: { step: -1, pending: true, declined: false } })).toBe(false);
    expect(showOffer({ ...base, s: { step: -1, pending: false, declined: true } })).toBe(false);
  });
});
