// The /record tour's state, shared by the tour (RecordTour.tsx) and the "? Tour" button that replays it: which card
// is open (-1: none). It mirrors the workshop guide's (world/guide/guideState.ts) without the room-view parts. It shows
// once per browser: the first time it opens, the browser remembers it (localStorage, which a private window or
// blocked storage may refuse, the getter itself may throw: then only this page remembers, and it shows next visit).
import { TOUR_STEPS } from "./tourSteps";

export const TOUR_SEEN_KEY = "sant.record.tour.seen";

/** The browser's storage, or none (a sandboxed frame, blocked site data: the getter itself throws). */
function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** This page's own memory, for when the browser's storage refuses. */
let seenHere = false;

export function seenTour(): boolean {
  if (seenHere) return true;
  try {
    return storage()?.getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTourSeen(): void {
  seenHere = true;
  try {
    storage()?.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    /* private mode, full or blocked storage: it shows again on the next visit, that's all */
  }
}

export interface TourState {
  /** The open card (0-based), or -1 when the tour is closed. */
  step: number;
  /** How it was opened: by itself on a first visit, or by the "? Tour" button (focus goes back there on close). */
  by: "auto" | "button" | null;
}

let state: TourState = { step: -1, by: null };
const fns = new Set<() => void>();
const set = (next: Partial<TourState>) => {
  state = { ...state, ...next };
  fns.forEach((fn) => fn());
};

export const tourState = () => state;
export function subscribeTour(fn: () => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}

export const TOUR_LAST = TOUR_STEPS.length - 1;

/** Open at a card (the tour is shown: it counts as seen from here). */
export function openTour(at = 0, by: TourState["by"] = "button"): void {
  markTourSeen();
  set({ step: Math.min(TOUR_LAST, Math.max(0, at)), by });
}

export function nextTour(): void {
  if (state.step < 0) return;
  if (state.step >= TOUR_LAST) closeTour();
  else set({ step: state.step + 1 });
}

export function prevTour(): void {
  if (state.step > 0) set({ step: state.step - 1 });
}

/** Skip, Done, Escape. */
export function closeTour(): void {
  if (state.step < 0) return;
  set({ step: -1 });
}

/** For tests: back to a first visit. */
export function resetTour(): void {
  seenHere = false;
  state = { step: -1, by: null };
  fns.forEach((fn) => fn());
}
