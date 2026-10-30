// The shelf: the spiral browsed in place, like a game menu. The page doesn't scroll in the workshop
// (the story ends there); clicking the spiral (or its tag, a filter, Ask SANT) opens the shelf on a
// cartridge, and the camera holds a shot facing it (store.setOverride). A wheel notch, a swipe or an
// arrow key moves one cartridge; Escape goes back to the room view. The detail view sits on top of
// the shelf and gives it back when it closes.
import { useEffect } from "react";
import { useWorld } from "../../core/WorldContext";
import type { WorldStore } from "../../core/store";
import type { HeldShot } from "../../core/types";
import { setSelected, spiral, stepCount } from "../../scene/spiral";
import { stepView } from "./camera";
import { hiddenInstance } from "./drag";

/** Wheel distance (px) that makes one step, and the pause between steps so a fling doesn't skip. */
const WHEEL_STEP = 40;
const STEP_GAP_MS = 240;
/** A swipe this long (px) moves one step. */
const SWIPE_PX = 36;

/** Shared, mutated in place: whether the shelf is open, and the step it faces. */
export const shelf = { open: false, step: 0 };

/** The last step there is to face: the last match with a filter on. */
export function lastStep(): number {
  return Math.max(0, stepCount() - 1);
}

/** The step one move away from `d` in `dir`, held inside the steps there are. */
export function nextStep(d: number, dir: 1 | -1, last = lastStep()): number {
  return Math.min(last, Math.max(0, Math.round(d) + dir));
}

/**
 * The shot facing step d, on the shelf's track: a step on from it glides round the spiral through the
 * cartridges in between (core/shot.ts), instead of flying straight to the new one and through the spiral.
 */
export function shelfShot(d: number): HeldShot {
  return { ...stepView(d), track: { id: "shelf", at: d, pose: stepView } };
}

/** Open the shelf on step d (a click on the spiral, a filter, Ask SANT, the detail view). */
export function scrollToStep(store: WorldStore, d: number): void {
  shelf.open = true;
  shelf.step = Math.min(lastStep(), Math.max(0, Math.round(d)));
  store.setOverride(shelfShot(shelf.step));
}

/** Back to the room view. */
export function closeShelf(store: WorldStore): void {
  if (!shelf.open) return;
  shelf.open = false;
  if (spiral.selected < 0) store.setOverride(null);
}

/**
 * The page let go of the held shot (the journey rail, a branch opening, ↑ Story): the shelf and a detail view
 * end with it (the guide, Ask SANT's tour, closes itself when the room view goes: guide/Guide.tsx). Before, they stayed open underneath: the wheel kept stepping the shelf (and the
 * page never scrolled), the camera stayed on it over the story, and Back from the machine landed on it with
 * none of the room's UI. Returns the unsubscribe.
 */
export function followRelease(store: WorldStore): () => void {
  return store.subscribe(() => {
    if (store.getCoarse().override !== null) return;
    shelf.open = false;
    if (spiral.selected >= 0) setSelected(-1);
  });
}

/** The shot the shelf holds now (the detail view returns to it). */
export function shelfView() {
  return shelf.open ? shelfShot(shelf.step) : null;
}

/** What the shelf's input needs from the page: whether it is browsing, a clock, and the move. */
export interface ShelfInputHost {
  browsing: () => boolean;
  now: () => number;
  /** One cartridge on (1) or back (-1). */
  step: (dir: 1 | -1) => void;
  close: () => void;
}

/** The shelf's wheel, key and touch handling, pure of the DOM's listeners so it is tested. */
export function createShelfInput(host: ShelfInputHost) {
  let acc = 0;
  let accAt = 0;
  let lastMove = -Infinity;
  let ty: number | null = null;
  const move = (dir: 1 | -1) => {
    const now = host.now();
    if (now - lastMove < STEP_GAP_MS) return;
    lastMove = now;
    host.step(dir);
  };
  return {
    wheel(e: Pick<WheelEvent, "deltaY" | "deltaMode" | "preventDefault">) {
      if (!host.browsing()) return;
      e.preventDefault();
      // Lines (Firefox) are about 16 px; a page (deltaMode 2) is one step whatever its size.
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * WHEEL_STEP : e.deltaY;
      const dir = dy > 0 ? 1 : -1;
      const now = host.now();
      if (now - accAt > 160 || Math.sign(acc) !== dir) acc = 0;
      accAt = now;
      acc += dy;
      if (Math.abs(acc) >= WHEEL_STEP) {
        acc = 0;
        move(dir);
      }
    },
    key(e: Pick<KeyboardEvent, "key" | "target" | "defaultPrevented" | "preventDefault">) {
      const t = e.target as HTMLElement | null;
      if (!host.browsing() || e.defaultPrevented || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Escape") {
        e.preventDefault();
        host.close();
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        move(-1);
      }
    },
    touchStart(e: Pick<TouchEvent, "touches">) {
      ty = e.touches[0]?.clientY ?? null;
    },
    touchMove(e: Pick<TouchEvent, "touches">) {
      if (!host.browsing() || ty === null) return;
      const y = e.touches[0]?.clientY ?? ty;
      if (Math.abs(y - ty) >= SWIPE_PX) {
        move(y < ty ? 1 : -1);
        ty = y;
      }
    },
  };
}

/** One cartridge on or back from where the shelf faces (the camera follows). */
export function stepShelf(store: WorldStore, dir: 1 | -1): void {
  const d = nextStep(shelf.step, dir);
  if (d === shelf.step) return;
  shelf.step = d;
  store.setOverride(shelfShot(d));
}

export function useStepper(): void {
  const { store, mode } = useWorld();
  // The stills have a shelf too (the list, the detail view): let go of it with the page in both.
  useEffect(() => followRelease(store), [store]);
  useEffect(() => {
    if (mode !== "3d") return;
    // Only the shelf itself: not under the detail view or an open branch, nor with a cartridge in the hand.
    const input = createShelfInput({
      browsing: () => shelf.open && spiral.selected < 0 && store.getCoarse().branch === null && hiddenInstance() < 0,
      now: () => performance.now(),
      step: (dir) => stepShelf(store, dir),
      close: () => closeShelf(store),
    });
    const onWheel = (e: WheelEvent) => input.wheel(e);
    const onKey = (e: KeyboardEvent) => input.key(e);
    const onTouchStart = (e: TouchEvent) => input.touchStart(e);
    const onTouchMove = (e: TouchEvent) => input.touchMove(e);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, [store, mode]);
}
