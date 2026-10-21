// The loader holds the page until the first scene is truly ready (progress.ts), shows what it waits for,
// and offers a way on when it takes too long.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorldContext, type WorldApi } from "../../core/WorldContext";
import { TIERS } from "../../core/quality";
import { createWorldStore } from "../../core/store";
import { STATIONS } from "../index";
import { CONTINUE_MS, Loader, STALL_MS } from "./Loader";
import { FRAMES, load } from "./progress";

function renderLoader({ reduced = false } = {}) {
  const store = createWorldStore(STATIONS, 800, 0);
  const fail = vi.fn();
  const api = { store, quality: TIERS.high, reduced, mode: "3d", fail } as unknown as WorldApi;
  render(
    <WorldContext.Provider value={api}>
      <Loader />
    </WorldContext.Provider>,
  );
  return { store, fail };
}

/** Every step of the first scene, done. */
function finish() {
  act(() => {
    load.set("engine", 1);
    load.count("fonts", 1, 1);
    load.set("build", 1);
    load.count("shaders", 5, 5);
    load.count("frames", FRAMES, FRAMES);
  });
}

const bar = () => screen.getByRole("progressbar", { name: "Loading SANT" });

describe("the loader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    load.reset();
    document.documentElement.style.overflow = "";
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("holds the page still while it loads, signed with the mark", () => {
    renderLoader();
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(screen.getByRole("img", { name: "SANT" })).toBeTruthy();
    expect(bar().getAttribute("aria-valuenow")).toBe("0");
  });

  it("moves with the real steps, and says what it is waiting for", () => {
    renderLoader();
    act(() => load.set("engine", 1));
    expect(Number(bar().getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    act(() => {
      load.count("fonts", 1, 1);
      load.set("build", 1);
      load.count("shaders", 7, 20);
    });
    expect(screen.getByText("Compiling shaders")).toBeTruthy();
    expect(screen.getByText("7 / 20")).toBeTruthy();
    expect(bar().getAttribute("aria-valuetext")).toBe("Compiling shaders, 7 / 20");
  });

  it("lets go only once every step is done: then the world is ready and the page scrolls again", () => {
    const { store } = renderLoader();
    act(() => {
      load.set("engine", 1);
      load.count("fonts", 1, 1);
      load.set("build", 1);
      load.count("shaders", 5, 5);
    });
    act(() => vi.advanceTimersByTime(5000));
    // Shaders done, but no steady frames yet: still held.
    expect(store.getCoarse().ready).toBe(false);
    expect(document.documentElement.style.overflow).toBe("hidden");
    finish();
    act(() => vi.advanceTimersByTime(2000));
    expect(store.getCoarse().ready).toBe(true);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("after a while offers to go on anyway, at what it has", () => {
    const { store } = renderLoader();
    act(() => load.set("engine", 1));
    expect(screen.queryByRole("button", { name: "Continue anyway" })).toBeNull();
    act(() => vi.advanceTimersByTime(CONTINUE_MS));
    fireEvent.click(screen.getByRole("button", { name: "Continue anyway" }));
    act(() => vi.advanceTimersByTime(2000));
    expect(store.getCoarse().ready).toBe(true);
    expect(load.released()).toBe(true);
  });

  it("or the 2D version, for a device that can't manage the 3D", () => {
    const { fail } = renderLoader();
    act(() => vi.advanceTimersByTime(CONTINUE_MS));
    fireEvent.click(screen.getByRole("button", { name: "Use the 2D version" }));
    expect(fail).toHaveBeenCalled();
  });

  it("falls back to the stills by itself if the 3D engine never even started", () => {
    const { fail } = renderLoader();
    act(() => vi.advanceTimersByTime(STALL_MS));
    expect(fail).toHaveBeenCalled();
  });

  it("waits on, rather than falling back, once the engine is up (the visitor can choose)", () => {
    const { fail } = renderLoader();
    act(() => load.set("engine", 1));
    act(() => vi.advanceTimersByTime(STALL_MS + 1000));
    expect(fail).not.toHaveBeenCalled();
  });

  it("with reduced motion lets go without its hold", () => {
    const { store } = renderLoader({ reduced: true });
    finish();
    act(() => vi.advanceTimersByTime(0));
    expect(store.getCoarse().ready).toBe(true);
  });
});
