// Scrolled ahead of what has arrived: a brief "loading" in place, with the real bytes, instead of an
// empty scene.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssets } from "../core/assets";
import { dwellStart } from "../core/rail";
import { createWorldStore } from "../core/store";
import { STATIONS } from "../stations";
import { stationFiles } from "../core/waiting";
import { SHOW_AFTER_MS, Wait } from "./Wait";

function setup() {
  const store = createWorldStore(STATIONS, 800, 0);
  // Past the loader: the in-place state is for later.
  store.setReady();
  const files = stationFiles("workshop", "high");
  const sizes = Object.fromEntries(files.map((u) => [u.replace(/^\//, ""), 1_000_000]));
  let finishAll: () => void = () => {};
  const fetchImpl = vi.fn(
    (u: string) =>
      new Promise<Response>((resolve) => {
        const prev = finishAll;
        finishAll = () => {
          prev();
          resolve(new Response(new Uint8Array(1_000_000)));
        };
        void u;
      }),
  );
  const assets = createAssets({ sizes, fetchImpl: fetchImpl as unknown as typeof fetch, base: "/", concurrency: 64 });
  return { store, assets, files, finish: () => finishAll() };
}

describe("waiting in place", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("says nothing at the hero", () => {
    const { store, assets } = setup();
    render(<Wait store={store} assets={assets} tier="high" reduced={false} />);
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS + 50));
    expect(screen.queryByRole("status")?.textContent ?? "").toBe("");
  });

  it("shows what is still coming where the visitor is, with its bytes, after a beat, and goes when it is in", async () => {
    const { store, assets, files, finish } = setup();
    assets.want(files);
    act(() => {
      store.jump(dwellStart(store.rail, "workshop")! + 10);
    });
    render(<Wait store={store} assets={assets} tier="high" reduced={false} />);
    // Not at once: a quick arrival never flashes.
    expect(screen.queryByText(/Loading the workshop/)).toBeNull();
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS + 50));
    expect(screen.getByText(/Loading the workshop/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/MB/);
    finish();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.queryByText(/Loading the workshop/)).toBeNull();
  });
});
