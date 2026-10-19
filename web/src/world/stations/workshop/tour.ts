// The workshop tour (Ask SANT's start_tutorial): the camera holds Blender's three tutorial stops in
// turn, each with its line, then gives the rail back. A wheel, a key or Escape ends it early.
import { useEffect, useSyncExternalStore } from "react";
import { useWorld } from "../../core/WorldContext";
import type { WorldStore } from "../../core/store";
import { stop, type StopName } from "../../scene/layout";

export const TOUR: { stop: StopName; title: string; line: string }[] = [
  { stop: "Tutorial 1 · shelf", title: "1  Pick a cartridge", line: "Every cartridge on the spiral is a job." },
  { stop: "Tutorial 2 · machine", title: "2  Plug it in", line: "The machine reads it and opens the page, where you teach it by showing." },
  { stop: "Tutorial 3 · bench", title: "3  Make a new one", line: "At the bench: pick a shell, name it, upload your robot." },
];
export const TOUR_STOP_MS = 3600;

let step = -1;
let timer: ReturnType<typeof setTimeout> | undefined;
const fns = new Set<() => void>();
const notify = () => fns.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  fns.add(fn);
  return () => fns.delete(fn);
};
export const tourStep = () => step;

function show(store: WorldStore, i: number) {
  if (timer) clearTimeout(timer);
  step = i;
  if (i < 0 || i >= TOUR.length) {
    step = -1;
    store.setOverride(null);
  } else {
    store.setOverride(stop(TOUR[i].stop));
    timer = setTimeout(() => show(store, i + 1), TOUR_STOP_MS);
  }
  notify();
}

export const startTour = (store: WorldStore) => show(store, 0);
export function endTour(store: WorldStore): void {
  if (step >= 0) show(store, -1);
}

/** The tour's caption, top centre; it ends the tour on a wheel, a key or a touch. */
export function useTour(): number {
  const { store } = useWorld();
  const now = useSyncExternalStore(subscribe, tourStep);
  useEffect(() => {
    if (now < 0) return;
    const end = () => endTour(store);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
      end();
    };
    window.addEventListener("wheel", end, { passive: true });
    window.addEventListener("touchstart", end, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", end);
      window.removeEventListener("touchstart", end);
      window.removeEventListener("keydown", onKey);
    };
  }, [now, store]);
  useEffect(() => () => endTour(store), [store]);
  return now;
}
