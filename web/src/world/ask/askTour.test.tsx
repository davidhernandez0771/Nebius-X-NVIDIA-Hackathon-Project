// Ask SANT's start_tutorial (polish, 2026-10-27): it opens the first-visit guide (guide/Guide.tsx), the same four cards
// the "?" replays, not the old camera tour (stations/workshop/tour.ts, retired). In the room view the first card opens;
// from anywhere else the guide takes the visitor to the room view first.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorldContext, type WorldApi } from "../core/WorldContext";
import type { Coarse, WorldStore } from "../core/store";
import { GuideLayer } from "../guide/Guide";
import { guideState, resetGuide, SEEN_KEY } from "../guide/guideState";
import { useAsk } from "./useAsk";

let ask: ((q: string) => Promise<void>) | null = null;
function Asker() {
  ask = useAsk().ask;
  return null;
}

function world(start: Partial<Coarse> = {}, arrive = 1) {
  const coarse = { current: "workshop", branch: null, override: null, ready: true, cartridge: null, height: 4000, ...start } as Coarse;
  const store = {
    getCoarse: () => coarse,
    subscribe: () => () => {},
    onFrame: () => () => {},
    frames: { workshop: { t: 1, arrive, current: true, near: true } },
    rail: { spans: [{ start: 0, end: 1000 }] },
  } as unknown as WorldStore;
  const api = { store, goTo: vi.fn(), reduced: true, mode: "3d" } as unknown as WorldApi;
  const toRoom = vi.fn();
  render(
    <MemoryRouter>
      <WorldContext.Provider value={api}>
        <Asker />
        <GuideLayer toRoom={toRoom} />
      </WorldContext.Provider>
    </MemoryRouter>,
  );
  return { toRoom };
}

beforeEach(() => {
  vi.useFakeTimers();
  // A returning visitor: the guide doesn't start by itself.
  window.localStorage.clear();
  window.localStorage.setItem(SEEN_KEY, "1");
  resetGuide();
  // The backend is down: the keyword rules pick start_tutorial for "give me a tour".
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  ask = null;
});

describe("Ask SANT's tour", () => {
  it("opens the first-visit guide at its first card, in the room view", async () => {
    world();
    await act(async () => void (await ask!("give me a tour")));
    await act(async () => void vi.advanceTimersByTime(800));
    expect(screen.getByRole("dialog", { name: "What SANT does" })).toBeTruthy();
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
    // Not the old camera tour's caption.
    expect(document.querySelector(".world-tour")).toBeNull();
  });

  it("from anywhere else, goes to the room view first and opens it there", async () => {
    const { toRoom } = world({ current: "intro" }, 0);
    await act(async () => void (await ask!("give me a tour")));
    expect(guideState().pending).toBe(true);
    expect(toRoom).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
