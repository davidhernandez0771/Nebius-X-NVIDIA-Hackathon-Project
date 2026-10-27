// The world's one store. Two speeds:
// - coarse state (current station, open branch, chosen cartridge, page height) changes rarely and is
//   read through useSyncExternalStore, so React re-renders only when the station changes;
// - per-frame state (the damped scroll, each station's StationFrame) is mutated in place and pushed
//   to frame listeners, never through React.
import { fillFrames, layoutRail, locate, type Place, type Rail } from "./rail";
import { RAIL_ORDER, type Cartridge, type HeldShot, type StationFrame, type StationId, type StationModule } from "./types";

export interface Coarse {
  current: StationId;
  branch: StationId | null;
  cartridge: Cartridge | null;
  /** Page height in px: the rail plus one viewport. */
  height: number;
  /**
   * The loader is done (the intro's shaders compiled). Until then only the intro's Scene is mounted,
   * so the workshop's files stream after the first frame instead of before it.
   */
  ready: boolean;
  /**
   * A shot the camera holds instead of the rail (the detail view, the shelf), or null. The rail's
   * stations stay current under it; the page scroll is held while it is set.
   */
  override: HeldShot | null;
}

type FrameListener = () => void;

export interface WorldStore {
  readonly rail: Rail;
  readonly rails: readonly StationModule[];
  readonly frames: Record<StationId, StationFrame>;
  /** The real scroll position. */
  readonly targetY: number;
  /** The position the camera shows (damped toward targetY with full motion). */
  readonly shownY: number;
  getCoarse(): Coarse;
  subscribe(fn: () => void): () => void;
  /** Called on scroll; returns where the scroll is. */
  setScroll(y: number): Place;
  /** Called by the camera rig each frame (or on scroll when there is no canvas). */
  setShown(y: number): void;
  /** Counts jump() calls, so the camera rig can tell one happened. */
  readonly jumps: number;
  /** Puts both the scroll and the camera at y with no glide in between (a cut behind the iris). */
  jump(y: number): void;
  onFrame(fn: FrameListener): () => void;
  /** Called on scroll so the canvas renders a frame. */
  onTarget(fn: () => void): () => void;
  setViewport(vh: number): void;
  /** Open a branch (or close with null). A playing branch starts at t0 (1: already played, e.g. Back). */
  setBranch(id: StationId | null, t0?: number): void;
  /** A playing branch's t, 0–1, written by the camera rig every frame it plays. */
  readonly branchT: number;
  /** Where the open branch started (setBranch's t0), for the camera rig. */
  readonly branchT0: number;
  setBranchT(t: number): void;
  setCartridge(c: Cartridge | null): void;
  setReady(): void;
  setOverride(pose: HeldShot | null): void;
}

const blankFrame = (): StationFrame => ({ t: 0, arrive: 0, current: false, near: false });

export function createWorldStore(stations: readonly StationModule[], vh: number, y = 0): WorldStore {
  const rails = RAIL_ORDER.map((id) => {
    const s = stations.find((m) => m.id === id);
    if (!s) throw new Error(`world: no station module for "${id}"`);
    return s;
  });
  const branches = stations.filter((s) => s.kind === "branch");
  const frames = Object.fromEntries(stations.map((s) => [s.id, blankFrame()])) as Record<StationId, StationFrame>;
  const railFrames = rails.map((s) => frames[s.id]);

  let rail = layoutRail(rails, vh);
  let viewport = vh;
  let targetY = y;
  let shownY = y;
  let jumps = 0;
  let branchT = 0;
  let branchT0 = 0;
  let coarse: Coarse = { current: rails[locate(rail, y).current].id, branch: null, cartridge: null, height: rail.total + vh, ready: false, override: null };
  const listeners = new Set<() => void>();
  const frameListeners = new Set<FrameListener>();
  const targetListeners = new Set<() => void>();

  const set = (patch: Partial<Coarse>) => {
    const next = { ...coarse, ...patch };
    if ((Object.keys(patch) as (keyof Coarse)[]).every((k) => next[k] === coarse[k])) return;
    coarse = next;
    listeners.forEach((fn) => fn());
  };

  const fill = () => {
    fillFrames(rail, shownY, railFrames);
    // With a branch open, the rail stations stay where they are but none is current.
    for (const b of branches) {
      const f = frames[b.id];
      const open = coarse.branch === b.id;
      f.t = open ? (b.duration ? branchT : 1) : 0;
      f.arrive = open ? 1 : 0;
      f.current = open;
      f.near = true;
    }
    if (coarse.branch) railFrames.forEach((f) => (f.current = false));
    frameListeners.forEach((fn) => fn());
  };
  fill();

  const store: WorldStore = {
    get rail() {
      return rail;
    },
    rails,
    frames,
    get targetY() {
      return targetY;
    },
    get shownY() {
      return shownY;
    },
    getCoarse: () => coarse,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setScroll(next) {
      targetY = next;
      const place = locate(rail, next);
      set({ current: rails[place.current].id });
      targetListeners.forEach((fn) => fn());
      return place;
    },
    setShown(next) {
      shownY = next;
      fill();
    },
    get jumps() {
      return jumps;
    },
    jump(next) {
      jumps++;
      shownY = next;
      store.setScroll(next);
      fill();
    },
    onFrame(fn) {
      frameListeners.add(fn);
      return () => frameListeners.delete(fn);
    },
    onTarget(fn) {
      targetListeners.add(fn);
      return () => targetListeners.delete(fn);
    },
    setViewport(next) {
      if (next === viewport || next <= 0) return;
      // Keep the same place on the rail: scale both scroll values with the new layout.
      const scale = next / viewport;
      viewport = next;
      rail = layoutRail(rails, next);
      targetY *= scale;
      shownY *= scale;
      set({ height: rail.total + next });
      fill();
    },
    get branchT() {
      return branchT;
    },
    get branchT0() {
      return branchT0;
    },
    setBranchT(t) {
      if (t === branchT) return;
      branchT = t;
      fill();
    },
    setBranch(id, t0 = 0) {
      branchT0 = id ? Math.min(1, Math.max(0, t0)) : 0;
      branchT = branchT0;
      set({ branch: id });
      fill();
      targetListeners.forEach((fn) => fn());
    },
    setCartridge(c) {
      set({ cartridge: c });
      targetListeners.forEach((fn) => fn());
    },
    setReady() {
      set({ ready: true });
      targetListeners.forEach((fn) => fn());
    },
    setOverride(pose) {
      set({ override: pose });
      targetListeners.forEach((fn) => fn());
    },
  };
  return store;
}
