// The spiral's scroll: one cartridge per step. In the workshop's dwell a wheel notch, a swipe or an
// arrow key moves exactly one step (the page scrolls there and the camera glides); a scrollbar drag or
// a touch flick snaps to the nearest step when it stops. With a filter on, the steps end at the last
// match. Past the first step (up) or the last (down, no filter) the page scrolls on as usual.
import { useEffect } from "react";
import { useWorld } from "../../core/WorldContext";
import type { WorldStore } from "../../core/store";
import { spiral, stepCount } from "../../scene/spiral";
import { stepOfT, tOfStep } from "./camera";

/** Wheel distance (px) that makes one step, and the pause between steps so a fling doesn't skip. */
const WHEEL_STEP = 40;
const STEP_GAP_MS = 260;
const SNAP_IDLE_MS = 180;

export interface StepGeometry {
  yOfStep(d: number): number;
  stepAtY(y: number): number;
  /** Half a step in px, the margin round the steps where the stepper still holds the scroll. */
  half: number;
  last: number;
}

export function stepGeometry(store: WorldStore, last = stepCount() - 1): StepGeometry | null {
  const span = store.rail.spans.find((s) => s.id === "workshop");
  if (!span) return null;
  const len = span.end - span.start;
  const yOfStep = (d: number) => span.start + tOfStep(d) * len;
  return { yOfStep, stepAtY: (y) => stepOfT((y - span.start) / len), half: (yOfStep(1) - yOfStep(0)) / 2, last };
}

/** Where a step key or wheel notch goes from y: the y to scroll to, or null to let the page scroll. */
export function nextY(g: StepGeometry, y: number, dir: 1 | -1, filtered: boolean): number | null {
  if (y < g.yOfStep(0) - g.half || y > g.yOfStep(g.last) + g.half) return null;
  const cur = Math.min(g.last, Math.max(0, Math.round(g.stepAtY(y))));
  const next = cur + dir;
  if (next < 0) return null;
  if (next > g.last) return filtered ? g.yOfStep(g.last) : null;
  return g.yOfStep(next);
}

/** The nearest step's y for a scroll that stopped in the steps (or null outside them). */
export function snapY(g: StepGeometry, y: number, filtered: boolean): number | null {
  if (y < g.yOfStep(0) - g.half) return null;
  if (y > g.yOfStep(g.last) + g.half) return filtered && y < g.yOfStep(g.last) + 4 * g.half ? g.yOfStep(g.last) : null;
  return g.yOfStep(Math.min(g.last, Math.max(0, Math.round(g.stepAtY(y)))));
}

function scrollToY(top: number) {
  try {
    window.scrollTo({ top, behavior: "auto" });
  } catch {
    /* jsdom */
  }
}

export function useStepper(): void {
  const { store } = useWorld();
  useEffect(() => {
    let acc = 0;
    let lastStep = 0;
    let accAt = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const busy = () => store.getCoarse().branch !== null || store.getCoarse().override !== null || spiral.selected >= 0;
    const go = (dir: 1 | -1, e: Event): boolean => {
      const g = stepGeometry(store);
      if (!g) return false;
      const y = nextY(g, store.targetY, dir, spiral.filter !== null);
      if (y === null) return false;
      e.preventDefault();
      const now = performance.now();
      if (now - lastStep < STEP_GAP_MS) return true;
      lastStep = now;
      if (Math.abs(y - store.targetY) > 0.5) scrollToY(y);
      return true;
    };
    const onWheel = (e: WheelEvent) => {
      if (busy()) return;
      const g = stepGeometry(store);
      if (!g) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const dir = dy > 0 ? 1 : -1;
      // Outside the steps, or leaving them at an end: the page scrolls as usual.
      if (nextY(g, store.targetY, dir, spiral.filter !== null) === null) return;
      e.preventDefault();
      const now = performance.now();
      if (now - accAt > 160 || Math.sign(acc) !== dir) acc = 0;
      accAt = now;
      acc += dy;
      if (Math.abs(acc) >= WHEEL_STEP) {
        acc = 0;
        go(dir, e);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (busy() || e.defaultPrevented || (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
      if (e.key === "ArrowDown" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) go(1, e);
      else if (e.key === "ArrowUp" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) go(-1, e);
    };
    const onScroll = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => {
        if (busy()) return;
        const g = stepGeometry(store);
        if (!g) return;
        const y = snapY(g, store.targetY, spiral.filter !== null);
        if (y !== null && Math.abs(y - store.targetY) > 1) scrollToY(y);
      }, SNAP_IDLE_MS);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
      if (idle) clearTimeout(idle);
    };
  }, [store]);
}

/** Scroll to an item's step (a click on it, a filter, Ask SANT). */
export function scrollToStep(store: WorldStore, d: number): void {
  const g = stepGeometry(store);
  if (g) scrollToY(g.yOfStep(Math.min(g.last, Math.max(0, d))));
}
