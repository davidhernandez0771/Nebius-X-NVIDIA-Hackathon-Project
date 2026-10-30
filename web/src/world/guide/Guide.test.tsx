// The guide in the page: it starts by itself on the first arrival in the room view (never over the story), the hero's
// offer and the "?" start it from anywhere, every card has Skip, Escape skips and the arrows step, and leaving the
// room ends it. (Where it stands and that real clicks reach it: guidePlace.test.ts, guideClicks.test.ts, and the
// CDP checks in docs/superpowers/notes/2026-10-27-tour.md.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorldContext, type WorldApi } from "../core/WorldContext";
import type { Coarse, WorldStore } from "../core/store";
import { GuideHelp, GuideLayer } from "./Guide";
import { guideState, resetGuide, SEEN_KEY } from "./guideState";

function world(start: Partial<Coarse> = {}, arrive = 1) {
  let coarse = { current: "workshop", branch: null, override: null, ready: true, cartridge: null, height: 4000, ...start } as Coarse;
  const subs = new Set<() => void>();
  const frames = { workshop: { t: 1, arrive, current: true, near: true } };
  const store = {
    getCoarse: () => coarse,
    subscribe: (fn: () => void) => (subs.add(fn), () => subs.delete(fn)),
    onFrame: () => () => {},
    frames,
  } as unknown as WorldStore;
  const api = { store, goTo: vi.fn(), reduced: true, mode: "3d" } as unknown as WorldApi;
  const toRoom = vi.fn();
  render(
    <MemoryRouter>
      <WorldContext.Provider value={api}>
        <GuideHelp />
        <GuideLayer toRoom={toRoom} />
      </WorldContext.Provider>
    </MemoryRouter>,
  );
  const set = (next: Partial<Coarse>, a = frames.workshop.arrive) =>
    act(() => {
      coarse = { ...coarse, ...next };
      frames.workshop.arrive = a;
      subs.forEach((fn) => fn());
    });
  return { api, toRoom, set };
}

const settle = () => act(() => vi.advanceTimersByTime(800));
const card = () => screen.queryByRole("dialog");
const press = (key: string, target: Element | Window = window) => act(() => void fireEvent.keyDown(target, { key }));

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  resetGuide();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the first-visit guide", () => {
  it("starts by itself the first time the visitor stands in the room view, at step 1, and is remembered", () => {
    world();
    settle();
    expect(card()).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "What SANT does" })).toBeTruthy();
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("1");
  });

  it("never over the story: on the hero it is only the small offer", () => {
    world({ current: "intro" }, 0);
    settle();
    expect(card()).toBeNull();
    expect(screen.getByRole("region", { name: "Tour" })).toBeTruthy();
  });

  it("doesn't start by itself on a later visit", () => {
    window.localStorage.setItem(SEEN_KEY, "1");
    world();
    settle();
    expect(card()).toBeNull();
  });

  it("the hero's Start goes to the room and opens there", () => {
    const { toRoom, set } = world({ current: "intro" }, 0);
    fireEvent.click(screen.getByRole("button", { name: /Start the tour/ }));
    expect(toRoom).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
    set({ current: "workshop" }, 1);
    settle();
    expect(screen.getByRole("dialog", { name: "What SANT does" })).toBeTruthy();
  });

  it("the hero's No thanks: the offer goes and the guide won't start by itself", () => {
    const { set } = world({ current: "intro" }, 0);
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(screen.queryByRole("region", { name: "Tour" })).toBeNull();
    set({ current: "workshop" }, 1);
    settle();
    expect(card()).toBeNull();
  });

  it("every step has Skip; Next, Back and Done walk the four", () => {
    world();
    settle();
    const titles = ["What SANT does", "Record a demo", "SANT checks and multiplies it", "Here's the proof"];
    for (let i = 0; i < 4; i++) {
      expect(screen.getByRole("dialog", { name: titles[i] })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
      if (i === 0) expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
      if (i < 3) fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    }
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("dialog", { name: titles[2] })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(card()).toBeNull();
  });

  it("Skip closes it", () => {
    world();
    settle();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(card()).toBeNull();
  });

  it("the keys: the arrows step, Escape skips, and the room's own keys don't also get them", () => {
    world();
    settle();
    const room = vi.fn();
    window.addEventListener("keydown", room);
    press("ArrowRight");
    expect(screen.getByText("Step 2 of 4")).toBeTruthy();
    press("ArrowRight");
    press("ArrowLeft");
    expect(screen.getByText("Step 2 of 4")).toBeTruthy();
    press("Escape");
    expect(card()).toBeNull();
    expect(room).not.toHaveBeenCalled();
    window.removeEventListener("keydown", room);
  });

  it("leaves typing alone (Ask SANT's box)", () => {
    world();
    settle();
    const input = document.createElement("input");
    document.body.appendChild(input);
    press("ArrowRight", input);
    press("Escape", input);
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
    input.remove();
  });

  it("ends when the visitor leaves the room view (a place opens, the shelf, the story)", () => {
    const { set } = world();
    settle();
    set({ branch: "machine" });
    expect(card()).toBeNull();
    set({ branch: null });
    settle();
    expect(card()).toBeNull();
  });

  it("the ? replays it from step 1, from the room or from anywhere", () => {
    window.localStorage.setItem(SEEN_KEY, "1");
    const { toRoom, set } = world({ current: "intro" }, 0);
    fireEvent.click(screen.getByRole("button", { name: "Replay the tour" }));
    expect(toRoom).toHaveBeenCalledTimes(1);
    set({ current: "workshop" }, 1);
    settle();
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(screen.getByRole("button", { name: "Replay the tour" }));
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
    expect(toRoom).toHaveBeenCalledTimes(1);
  });

  it("the proof step opens the proof wall and links the test track and Record", () => {
    const { api } = world();
    settle();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("link", { name: /Open Record/ }).getAttribute("href")).toBe("/record");
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("link", { name: /Watch the test track/ }).getAttribute("href")).toBe("/test-track");
    fireEvent.click(screen.getByRole("button", { name: /Open the proof wall/ }));
    expect(api.goTo).toHaveBeenCalledWith("proof");
    expect(guideState().step).toBe(-1);
  });
});
