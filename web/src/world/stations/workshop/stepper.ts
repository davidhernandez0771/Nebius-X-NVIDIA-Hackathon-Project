// The shelf: the spiral browsed in place, like a game menu. The page doesn't scroll in the workshop
// (the story ends there); clicking the spiral (or its tag, a filter, Ask SANT) opens the shelf on a
// cartridge, and the camera holds a shot facing it (store.setOverride). A wheel notch, a swipe or an
// arrow key moves one cartridge; Escape goes back to the room view. The detail view sits on top of
// the shelf and gives it back when it closes.
import { useEffect } from "react";
import { useWorld } from "../../core/WorldContext";
import type { WorldStore } from "../../core/store";
import { spiral, stepCount } from "../../scene/spiral";
import { stepView } from "./camera";

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

/** Open the shelf on step d (a click on the spiral, a filter, Ask SANT, the detail view). */
export function scrollToStep(store: WorldStore, d: number): void {
  shelf.open = true;
  shelf.step = Math.min(lastStep(), Math.max(0, Math.round(d)));
  store.setOverride(stepView(shelf.step));
}

/** Back to the room view. */
export function closeShelf(store: WorldStore): void {
  if (!shelf.open) return;
  shelf.open = false;
  if (spiral.selected < 0) store.setOverride(null);
}

/** The shot the shelf holds now (the detail view returns to it). */
export function shelfView() {
  return shelf.open ? stepView(shelf.step) : null;
}

export function useStepper(): void {
  const { store, mode } = useWorld();
  useEffect(() => {
    if (mode !== "3d") return;
    let acc = 0;
    let accAt = 0;
    let lastMove = 0;
    let ty: number | null = null;
    // Only the shelf itself: not under the detail view or an open branch.
    const browsing = () => shelf.open && spiral.selected < 0 && store.getCoarse().branch === null;
    const move = (dir: 1 | -1) => {
      const now = performance.now();
      if (now - lastMove < STEP_GAP_MS) return;
      lastMove = now;
      const d = nextStep(shelf.step, dir);
      if (d === shelf.step) return;
      shelf.step = d;
      store.setOverride(stepView(d));
    };
    const onWheel = (e: WheelEvent) => {
      if (!browsing()) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const dir = dy > 0 ? 1 : -1;
      const now = performance.now();
      if (now - accAt > 160 || Math.sign(acc) !== dir) acc = 0;
      accAt = now;
      acc += dy;
      if (Math.abs(acc) >= WHEEL_STEP) {
        acc = 0;
        move(dir);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!browsing() || e.defaultPrevented || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeShelf(store);
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        move(-1);
      }
    };
    const onTouchStart = (e: TouchEvent) => (ty = e.touches[0]?.clientY ?? null);
    const onTouchMove = (e: TouchEvent) => {
      if (!browsing() || ty === null) return;
      const y = e.touches[0]?.clientY ?? ty;
      if (Math.abs(y - ty) >= SWIPE_PX) {
        move(y < ty ? 1 : -1);
        ty = y;
      }
    };
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
