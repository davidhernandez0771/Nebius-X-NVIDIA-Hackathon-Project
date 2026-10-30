// The /record tour in the page: it opens by itself once per browser after the page draws in (never while the visitor
// is already driving), every card has Skip, Escape skips and the arrows step, "? Tour" replays it, and the drive's
// keys are never held: the arrows and Escape are the tour's only while it is open, the card's own Enter and Space go
// no further than its buttons, and once it closes W/A/S/D, Space, Enter and the arrows all reach the page again.
// (That real clicks reach it: tourClicks.test.ts and web/scripts/record-tour-clicks.mjs.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MotionProvider } from "../../../sant/motion/MotionProvider";
import { AUTO_MS, RecordTour, TourButton } from "./RecordTour";
import { TOUR_SEEN_KEY, resetTour, tourState } from "./tourState";
import { TOUR_STEPS } from "./tourSteps";

function page(streaming = false) {
  return render(
    <MotionProvider>
      <div className="rg">
        <TourButton />
        <RecordTour streaming={streaming} />
      </div>
    </MotionProvider>,
  );
}

const settle = () => act(() => vi.advanceTimersByTime(AUTO_MS + 50));
const card = () => screen.queryByRole("dialog");
const press = (key: string, target: Element = document.body, code = key) => act(() => void fireEvent.keyDown(target, { key, code }));
const titles = TOUR_STEPS.map((s) => s.title);

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  resetTour();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the /record tour", () => {
  it("opens by itself on a first visit, after the page draws in, at card 1, and is remembered", () => {
    page();
    expect(card()).toBeNull();
    settle();
    expect(screen.getByRole("dialog", { name: titles[0] })).toBeTruthy();
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeTruthy();
    expect(window.localStorage.getItem(TOUR_SEEN_KEY)).toBe("1");
  });

  it("doesn't open by itself on a later visit", () => {
    window.localStorage.setItem(TOUR_SEEN_KEY, "1");
    page();
    settle();
    expect(card()).toBeNull();
  });

  it("doesn't open by itself over a visitor who is already driving", () => {
    page(true);
    settle();
    expect(card()).toBeNull();
  });

  it("every card has Skip; Next, Back and Done walk all six", () => {
    page();
    settle();
    for (let i = 0; i < titles.length; i++) {
      expect(screen.getByRole("dialog", { name: titles[i] })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
      if (i === 0) expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
      if (i < titles.length - 1) fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    }
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("dialog", { name: titles[titles.length - 2] })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(card()).toBeNull();
  });

  it("Skip closes it", () => {
    page();
    settle();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(card()).toBeNull();
  });

  it("while open, the arrows step and Escape skips, and the drive doesn't also get them", () => {
    page();
    settle();
    const drive = vi.fn();
    window.addEventListener("keydown", drive);
    try {
      press("ArrowRight");
      expect(screen.getByText(`Step 2 of ${TOUR_STEPS.length}`)).toBeTruthy();
      press("ArrowRight");
      press("ArrowLeft");
      expect(screen.getByText(`Step 2 of ${TOUR_STEPS.length}`)).toBeTruthy();
      press("ArrowUp"); // the arm's forward: held while the tour is open, it does nothing
      press("ArrowDown");
      expect(screen.getByText(`Step 2 of ${TOUR_STEPS.length}`)).toBeTruthy();
      press("Escape");
      expect(card()).toBeNull();
      expect(drive).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", drive);
    }
  });

  it("Enter and Space on the card's buttons go no further (no recording, no grip)", () => {
    page();
    settle();
    const drive = vi.fn();
    window.addEventListener("keydown", drive);
    try {
      const next = screen.getByRole("button", { name: /Next/ });
      press("Enter", next, "Enter");
      press(" ", next, "Space");
      expect(drive).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", drive);
    }
  });

  it("never holds the drive's keys: W, A, S, D, Space, Enter and the arrows reach the page while it's open elsewhere and after it closes", () => {
    page();
    settle();
    const drive = vi.fn();
    window.addEventListener("keydown", drive);
    try {
      // Open: the letters, Space and Enter outside the card still drive.
      for (const [key, code] of [["w", "KeyW"], [" ", "Space"], ["Enter", "Enter"]]) press(key, document.body, code);
      expect(drive).toHaveBeenCalledTimes(3);
      drive.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
      expect(card()).toBeNull();
      const keys: [string, string][] = [["w", "KeyW"], ["a", "KeyA"], ["s", "KeyS"], ["d", "KeyD"], [" ", "Space"], ["Enter", "Enter"], ["ArrowUp", "ArrowUp"], ["ArrowLeft", "ArrowLeft"], ["ArrowRight", "ArrowRight"], ["Escape", "Escape"]];
      for (const [key, code] of keys) press(key, document.body, code);
      expect(drive).toHaveBeenCalledTimes(keys.length);
      expect(drive.mock.calls.every(([e]) => !(e as KeyboardEvent).defaultPrevented)).toBe(true);
    } finally {
      window.removeEventListener("keydown", drive);
    }
  });

  it("leaves typing alone: keys in a field outside the card are the field's", () => {
    page();
    settle();
    const field = document.createElement("input");
    document.body.appendChild(field);
    try {
      press("ArrowRight", field);
      press("Escape", field);
      expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeTruthy();
    } finally {
      field.remove();
    }
  });

  it("“? Tour” replays it from card 1, and focus goes back to it on close", () => {
    window.localStorage.setItem(TOUR_SEEN_KEY, "1");
    page();
    settle();
    expect(card()).toBeNull();
    const btn = screen.getByRole("button", { name: "Replay the tour" });
    fireEvent.click(btn);
    expect(screen.getByRole("dialog", { name: titles[0] })).toBeTruthy();
    expect(document.activeElement).toBe(card());
    press("ArrowRight");
    fireEvent.click(btn);
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeTruthy();
    press("Escape");
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("leaving the page ends it", () => {
    const { unmount } = page();
    settle();
    expect(tourState().step).toBe(0);
    unmount();
    expect(tourState().step).toBe(-1);
  });

  it("rings the real things: one ring per target, on when the target is on screen", () => {
    page();
    // jsdom has no layout: give the camera pane a box, and the first card's ring finds it.
    const cam = document.createElement("section");
    cam.className = "rg-cam";
    cam.getBoundingClientRect = () => ({ left: 16, top: 50, width: 700, height: 500, right: 716, bottom: 550, x: 16, y: 50, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(cam);
    try {
      settle();
      act(() => vi.advanceTimersByTime(50)); // a frame
      const rings = document.querySelectorAll<HTMLElement>(".rg-tour__ring");
      expect(rings).toHaveLength(TOUR_STEPS[0].rings.length);
      expect(rings[0].dataset.on).toBe("true");
      expect(rings[0].style.left).toBe("10px");
      expect(card()!.dataset.placed).toBe("true");
    } finally {
      cam.remove();
    }
  });

  describe("when the storage refuses", () => {
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

    it("still opens, and this page remembers it was shown", () => {
      const { unmount } = page();
      settle();
      expect(card()).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
      unmount();
      page();
      settle();
      expect(card()).toBeNull();
    });
  });
});
