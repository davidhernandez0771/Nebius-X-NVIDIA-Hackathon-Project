// What a station module can reach: the store, the quality tier, reduced motion, and the journey's
// actions. Works inside the canvas too (react-three-fiber bridges context into it).
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { QualityTier, WorldMode } from "./quality";
import type { Coarse, WorldStore } from "./store";
import type { Cartridge, StationFrame, StationId } from "./types";

export interface WorldApi {
  store: WorldStore;
  quality: QualityTier;
  reduced: boolean;
  /** "3d" with the canvas, or "stills" without a usable GPU. */
  mode: WorldMode;
  /** The canvas can't run (no context, the loader stalled): switch to the stills. */
  fail(): void;
  /** Scroll to a rail station's dwell, or open a branch station (the workbench). */
  goTo(id: StationId): void;
  /** Close the open branch: the camera returns to the rail where the scroll is. */
  back(): void;
  selectCartridge(c: Cartridge | null): void;
  /** Leave for the chosen cartridge's 2D route now (the zoom does this itself at the end of the rail). */
  handoff(): void;
}

export const WorldContext = createContext<WorldApi | null>(null);

export function useWorld(): WorldApi {
  const api = useContext(WorldContext);
  if (!api) throw new Error("useWorld() outside the world (WorldRoot)");
  return api;
}

/** A slice of the coarse state; re-renders only when that slice changes. */
export function useWorldState<T>(select: (c: Coarse) => T): T {
  const { store } = useWorld();
  return useSyncExternalStore(store.subscribe, () => select(store.getCoarse()));
}

/**
 * Per-frame DOM updates for an overlay: `onFrame` gets the station's frame whenever the camera
 * moves. Write to element styles in it, never to React state.
 */
export function useStationFrame(id: StationId, onFrame: (f: StationFrame) => void): void {
  const { store } = useWorld();
  const cb = useRef(onFrame);
  cb.current = onFrame;
  useEffect(() => {
    const run = () => cb.current(store.frames[id]);
    run();
    return store.onFrame(run);
  }, [store, id]);
}

/**
 * Inside the canvas: keep rendering every frame while `on` (an idle loop such as a flicker). Only
 * the high and ultra tiers allow it; on low the world renders only when something moves.
 */
export function useWorldAnimating(on: boolean): void {
  const { quality } = useWorld();
  const invalidate = useThree((s) => s.invalidate);
  const live = on && quality.idleMotion;
  const ref = useRef(live);
  ref.current = live;
  useEffect(() => {
    if (live) invalidate();
  }, [live, invalidate]);
  useFrame(() => {
    if (ref.current) invalidate();
  });
}
