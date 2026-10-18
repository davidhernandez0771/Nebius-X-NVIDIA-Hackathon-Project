// The handoff from the zoom to a 2D route. The camera dollies into the machine's projection; over
// the last part of the zoom a DOM screen in the app's ground fades up over it; at the end of the
// rail the route changes under that screen. It fires only on the way down: coming back to the world
// at the end of the rail (Back, a reload) doesn't send you straight out again until you have
// scrolled back up past ARM_BELOW. Pure, so the rule is tested.
import type { Place } from "./rail";

/** Zoom t from which the DOM screen starts to cover the canvas. */
export const SCREEN_FROM = 0.78;
/** Zoom t at which the route changes (the screen is opaque from here). */
export const FIRE_AT = 0.995;
/** Zoom t below which the handoff is armed again. */
export const ARM_BELOW = 0.9;

export interface HandoffState {
  armed: boolean;
}

export const INITIAL_HANDOFF: HandoffState = { armed: false };

export function handoffStep(s: HandoffState, place: Place, zoomIndex: number): { state: HandoffState; fire: boolean } {
  const atZoom = place.index === zoomIndex && place.phase === "dwell";
  if (!atZoom || place.t < ARM_BELOW) return { state: s.armed ? s : { armed: true }, fire: false };
  if (place.t >= FIRE_AT && s.armed) return { state: { armed: false }, fire: true };
  return { state: s, fire: false };
}

/** Opacity of the handoff screen at zoom t. */
export function screenOpacity(t: number): number {
  if (t <= SCREEN_FROM) return 0;
  return Math.min(1, (t - SCREEN_FROM) / (FIRE_AT - SCREEN_FROM));
}

const RETURN_KEY = "world.return";

/** Remember which station to come back to after the 2D route (session only; storage may throw). */
export function saveReturn(storage: Storage | undefined, station: string): void {
  try {
    storage?.setItem(RETURN_KEY, station);
  } catch {
    /* private mode: Back starts the journey from the top */
  }
}

export function takeReturn(storage: Storage | undefined): string | null {
  try {
    const v = storage?.getItem(RETURN_KEY) ?? null;
    storage?.removeItem(RETURN_KEY);
    return v;
  } catch {
    return null;
  }
}
