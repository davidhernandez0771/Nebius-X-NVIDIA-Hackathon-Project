// The shelf scroll bug (2026-10-20): scrolling the spiral should walk the camera round it one cartridge
// at a time, but after a few steps it zoomed in, as if it skipped the cartridges already passed. These
// fly the camera the way CameraRig does (core/shot.ts), frame by frame, under real input sequences.
import { afterEach, describe, expect, it } from "vitest";
import { createWorldStore, type WorldStore } from "../../core/store";
import { heldShot, mixShot, newShot, retarget } from "../../core/shot";
import type { CameraPose } from "../../core/types";
import { STATIONS } from "..";
import { ITEMS } from "../../scene/items";
import { N_ITEMS, resetSpiral, setFilter, stepCount } from "../../scene/spiral";
import { stepView } from "./camera";
import { closeShelf, createShelfInput, scrollToStep, shelf, stepShelf } from "./stepper";

const FPS = 60;
const radius = (p: CameraPose) => Math.hypot(p.position[0], p.position[2]);
const azimuth = (p: CameraPose) => Math.atan2(p.position[2], p.position[0]);
const RADII = Array.from({ length: N_ITEMS }, (_, d) => radius(stepView(d)));
/** The orbit the browsing camera keeps: between the nearest and farthest step views, plus a little. */
const R_MIN = Math.min(...RADII) - 0.25;
const R_MAX = Math.max(...RADII) + 0.25;

type Input = ReturnType<typeof createShelfInput>;

interface Flight {
  poses: CameraPose[];
  steps: number[];
}

/** Open the shelf on `from`, play `events` (time in s -> what the user does) and fly the camera at 60 fps. */
function fly(store: WorldStore, from: number, events: [number, (input: Input) => void][], seconds: number): Flight {
  let clock = 0;
  const input = createShelfInput({
    browsing: () => shelf.open,
    now: () => clock * 1000,
    step: (dir) => stepShelf(store, dir),
    close: () => closeShelf(store),
  });
  scrollToStep(store, from);
  const s = newShot();
  const poses: CameraPose[] = [];
  const steps: number[] = [];
  const queue = [...events].sort((a, b) => a[0] - b[0]);
  for (let f = 0; f <= seconds * FPS; f++) {
    clock = f / FPS;
    while (queue.length && queue[0][0] <= clock) queue.shift()![1](input);
    // As CameraRig does with a held shot.
    const held = heldShot(s, store.getCoarse().override!, 1 / FPS, false);
    retarget(s, held.dest, held.key, clock, false, held.arc);
    poses.push(mixShot(s, held.dest, clock).pose);
    steps.push(shelf.step);
  }
  return { poses, steps };
}

const wheel = (deltaY: number, deltaMode = 0) => (i: Input) => i.wheel({ deltaY, deltaMode, preventDefault() {} });
const key = (k: string) => (i: Input) => i.key({ key: k, target: null, defaultPrevented: false, preventDefault() {} });
const touch = (y: number, start = false) => (i: Input) => (start ? i.touchStart : i.touchMove)({ touches: [{ clientY: y }] } as never);

/** Notches of a mouse wheel: `n` of them, `gap` seconds apart, from t = 0.1. */
const notches = (n: number, gap: number, deltaY = 100) => Array.from({ length: n }, (_, k) => [0.1 + k * gap, wheel(deltaY)] as [number, (i: Input) => void]);

/** The camera keeps to the orbit and walks round it one way, through every cartridge it passes. */
function expectOrbit(flight: Flight, dir: 1 | -1 = 1): void {
  const bad = flight.poses.map(radius).findIndex((r) => r < R_MIN || r > R_MAX);
  expect(bad, `off the orbit at frame ${bad}: r = ${radius(flight.poses[Math.max(0, bad)]).toFixed(2)} (orbit ${R_MIN.toFixed(2)}-${R_MAX.toFixed(2)})`).toBe(-1);
  // Unwrapped azimuth never turns back by more than a hair: no cutting across, no skipping.
  let prev = azimuth(flight.poses[0]);
  let turned = 0;
  for (const p of flight.poses.slice(1)) {
    let da = azimuth(p) - prev;
    da = ((da + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    prev = azimuth(p);
    expect(da * dir, "the camera turned back").toBeGreaterThan(-0.01);
    turned += da;
  }
  const first = flight.steps[0];
  const last = flight.steps[flight.steps.length - 1];
  // It ends facing the cartridge the scroll is on.
  expect(flight.poses[flight.poses.length - 1].position.map((v) => +v.toFixed(3))).toEqual(stepView(last).position.map((v) => +v.toFixed(3)));
  if (last !== first) expect(Math.abs(turned)).toBeGreaterThan(0.5 * Math.abs(last - first) * ((2 * Math.PI) / 9));
}

describe("scrolling the shelf walks the camera round the spiral", () => {
  afterEach(() => {
    shelf.open = false;
    shelf.step = 0;
    resetSpiral();
  });

  it("one wheel notch is one cartridge, each notch in turn", () => {
    const store = createWorldStore(STATIONS, 1000);
    const flight = fly(store, 0, notches(6, 1.5), 10);
    expect(flight.steps[flight.steps.length - 1]).toBe(6);
    expectOrbit(flight);
  });

  it("steady scrolling (a notch every 0.3 s) stays on the orbit", () => {
    const store = createWorldStore(STATIONS, 1000);
    const flight = fly(store, 0, notches(10, 0.3), 5);
    expect(flight.steps[flight.steps.length - 1]).toBe(10);
    expectOrbit(flight);
  });

  it("a fast flick (notches every 30 ms) moves at most one cartridge per 240 ms and stays on the orbit", () => {
    const store = createWorldStore(STATIONS, 1000);
    const flight = fly(store, 0, notches(30, 0.03), 4);
    const last = flight.steps[flight.steps.length - 1];
    expect(last).toBeGreaterThan(1);
    expect(last).toBeLessThanOrEqual(Math.ceil(0.9 / 0.24) + 1);
    expectOrbit(flight);
  });

  it("a trackpad (many small deltas) stays on the orbit", () => {
    const store = createWorldStore(STATIONS, 1000);
    const events = Array.from({ length: 120 }, (_, k) => [0.1 + k / 60, wheel(6)] as [number, (i: Input) => void]);
    const flight = fly(store, 0, events, 5);
    expect(flight.steps[flight.steps.length - 1]).toBeGreaterThan(3);
    expectOrbit(flight);
  });

  it("scrolling back up walks the other way", () => {
    const store = createWorldStore(STATIONS, 1000);
    const flight = fly(store, 12, notches(8, 0.3, -100), 5);
    expect(flight.steps[flight.steps.length - 1]).toBe(4);
    expectOrbit(flight, -1);
  });

  it("touch swipes and held arrow keys stay on the orbit", () => {
    const store = createWorldStore(STATIONS, 1000);
    const swipe: [number, (i: Input) => void][] = [[0.1, touch(600, true)], ...Array.from({ length: 60 }, (_, k) => [0.12 + k / 60, touch(600 - (k + 1) * 8)] as [number, (i: Input) => void])];
    expectOrbit(fly(store, 0, swipe, 4));
    const held = Array.from({ length: 45 }, (_, k) => [0.1 + k / 30, key("ArrowDown")] as [number, (i: Input) => void]);
    const flight = fly(store, 0, held, 5);
    expect(flight.steps[flight.steps.length - 1]).toBeGreaterThan(4);
    expectOrbit(flight);
  });

  it("scrolls to the very last cartridge and stops there", () => {
    const store = createWorldStore(STATIONS, 1000);
    const flight = fly(store, N_ITEMS - 6, notches(10, 0.3), 6);
    expect(flight.steps[flight.steps.length - 1]).toBe(N_ITEMS - 1);
    expectOrbit(flight);
  });

  it("with a filter on, it stops at the last match", () => {
    const tag = ITEMS[0].tag;
    setFilter(tag);
    const store = createWorldStore(STATIONS, 1000);
    const flight = fly(store, 0, notches(stepCount() + 3, 0.3), 6);
    expect(flight.steps[flight.steps.length - 1]).toBe(stepCount() - 1);
    expectOrbit(flight);
  });

  it("every view between two steps is on the orbit too, the helix's gap included", () => {
    for (let d = 0; d <= N_ITEMS - 1; d += 0.05) {
      const r = radius(stepView(d));
      expect(r).toBeGreaterThan(R_MIN);
      expect(r).toBeLessThan(R_MAX);
    }
  });

  it("a far jump (a filter, Ask SANT: back to the top) tweens round the spiral, not through it", () => {
    const store = createWorldStore(STATIONS, 1000);
    const flight = fly(store, 14, [[0.2, () => scrollToStep(store, 0)]], 3);
    expect(flight.steps[flight.steps.length - 1]).toBe(0);
    const inner = Math.min(...flight.poses.map(radius));
    expect(inner).toBeGreaterThan(R_MIN);
    expect(flight.poses[flight.poses.length - 1]).toEqual(stepView(0));
  });

  it("with reduced motion each step is a cut, not a glide", () => {
    const store = createWorldStore(STATIONS, 1000);
    scrollToStep(store, 2);
    const s = newShot();
    const cuts: boolean[] = [];
    for (let k = 0; k < 4; k++) {
      if (k) stepShelf(store, 1);
      const held = heldShot(s, store.getCoarse().override!, 1 / FPS, true);
      expect(held.dest).toEqual(stepView(2 + k));
      cuts.push(retarget(s, held.dest, held.key, k, true, held.arc));
    }
    expect(cuts).toEqual([false, true, true, true]);
  });
});
