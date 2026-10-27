// The first-visit guide's state, shared by the guide itself (Guide.tsx), the hero's offer and the "?" that replays
// it: which step is open (-1: none), and whether a start is waiting for the room view. It shows once per browser:
// the first time the visitor stands in the room view (or asks from the hero), the browser remembers it
// (localStorage, which a private window or blocked storage may refuse: then it is only this page's memory).
import type { Coarse } from "../core/store";
import { GUIDE_STEPS } from "./guideSteps";

export const SEEN_KEY = "sant.guide.seen";

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

export function seenGuide(): boolean {
  if (seenHere) return true;
  try {
    return storage()?.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markGuideSeen(): void {
  seenHere = true;
  try {
    storage()?.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode, full or blocked storage: it shows again on the next visit, that's all */
  }
}

export interface GuideState {
  /** The open step (0-based), or -1 when the guide is closed. */
  step: number;
  /** A start is waiting for the room view (the hero's offer, the "?" from elsewhere). */
  pending: boolean;
  /** The visitor said no to the hero's offer (this page only). */
  declined: boolean;
}

let state: GuideState = { step: -1, pending: false, declined: false };
const fns = new Set<() => void>();
const set = (next: Partial<GuideState>) => {
  state = { ...state, ...next };
  fns.forEach((fn) => fn());
};

export const guideState = () => state;
export function subscribeGuide(fn: () => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}

export const LAST = GUIDE_STEPS.length - 1;

/** Open at a step (the guide is shown: it counts as seen from here). */
export function openGuide(at = 0): void {
  markGuideSeen();
  set({ step: Math.min(LAST, Math.max(0, at)), pending: false });
}

/** Start it as soon as the room view is up (from the hero, or the "?" anywhere). */
export function requestGuide(): void {
  // Already open (so in the room view): back to the first card.
  if (state.step >= 0) set({ step: 0, pending: false });
  else set({ pending: true });
}

export function nextStep(): void {
  if (state.step < 0) return;
  if (state.step >= LAST) closeGuide();
  else set({ step: state.step + 1 });
}

export function prevStep(): void {
  if (state.step > 0) set({ step: state.step - 1 });
}

/** Skip, Done, Escape, or the visitor left the room view. */
export function closeGuide(): void {
  if (state.step < 0 && !state.pending) return;
  set({ step: -1, pending: false });
}

/** "No thanks" on the hero's offer: it goes, and the guide won't start by itself (the "?" still replays it). */
export function declineGuide(): void {
  markGuideSeen();
  set({ declined: true, pending: false });
}

/** For tests: back to a first visit. */
export function resetGuide(): void {
  seenHere = false;
  state = { step: -1, pending: false, declined: false };
  fns.forEach((fn) => fn());
}

/**
 * The workshop's room view, where every step's target is on screen: the rail in the workshop, arrived, with no
 * place open and no held shot (the shelf, a detail view, Ask SANT's camera tour). CameraRig's inHub, on the coarse
 * state, so this module doesn't pull the 3D in.
 */
export function inRoomView(c: Pick<Coarse, "current" | "branch" | "override">, arrive: number): boolean {
  return c.current === "workshop" && c.branch === null && c.override === null && arrive >= 1;
}

/** The hero's offer shows at the top of the story only: the page loaded, a first visit, nothing else going on. */
export function showOffer(o: { ready: boolean; current: string; scrollY: number; vh: number; seen: boolean; s: GuideState }): boolean {
  return o.ready && o.current === "intro" && o.scrollY < o.vh * 0.3 && !o.seen && !o.s.declined && !o.s.pending && o.s.step < 0;
}
