// What the robots view highlights, shared by the wall (3D) and the catalog panel (DOM): the robot under
// the pointer or the keyboard focus, and the last one picked on the wall (the panel shows it). A tiny
// external store, so the canvas reads it per frame and the panel through useSyncExternalStore.
import { CATALOG } from "./catalog";

export interface RobotsViewState {
  hot: string | null;
  picked: string | null;
  /** Counts picks, so picking the same robot again still scrolls the panel to it. */
  pickCount: number;
}

const INITIAL: RobotsViewState = { hot: null, picked: null, pickCount: 0 };

function createRobotsView() {
  let state = INITIAL;
  const listeners = new Set<() => void>();
  const set = (next: RobotsViewState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  return {
    get: () => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    setHot(id: string | null) {
      if (state.hot !== id) set({ ...state, hot: id });
    },
    pick(id: string) {
      set({ hot: id, picked: id, pickCount: state.pickCount + 1 });
    },
    reset() {
      set(INITIAL);
    },
  };
}

export const robotsView = createRobotsView();

/** The robot's number on the wall (aSpot.w in wallParts.ts): catalog order from 1; 0 for none. */
export function hotNumber(id: string | null): number {
  return id ? CATALOG.findIndex((r) => r.id === id) + 1 : 0;
}
