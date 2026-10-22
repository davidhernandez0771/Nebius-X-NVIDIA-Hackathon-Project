// Runs the room builder (rooms.ts) inside the canvas. Under the loader, once the hero's shaders are
// done, it mounts the later scenes whose files are in, one per frame out of sight, then compiles
// everything (every object shown for the compile, so nothing compiles again on its first visible frame)
// and uploads the textures. After the reveal it builds what is left one room per idle moment
// (requestIdleCallback), compiling each the same way, and builds a room at once when the visitor reaches it.
import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Texture, type Camera, type Material, type Object3D, type WebGLRenderer } from "three";
import { compileSafe } from "../../three/compileSafe";
import { load } from "../stations/intro/progress";
import { INTRO_VH } from "../stations/intro/storyPlan";
import { assets } from "./assets";
import { beforeWarm } from "./Perf";
import type { TierName } from "./quality";
import { createRoomBuilder, rooms } from "./rooms";
import { isStanding } from "./standing";
import type { WorldStore } from "./store";
import type { StationModule } from "./types";
import { roomFiles, roomOrder, roomAt } from "./waiting";

/** Files still on their way when the rooms step starts get this long to finish. */
const GRACE_MS = 2000;

/** Compile everything in the scene, hidden things included, and upload its textures. */
function compileAll(gl: WebGLRenderer, scene: Object3D, camera: Camera, onProgress?: (n: number, total: number) => void): Promise<void> {
  beforeWarm.forEach((fn) => fn(scene));
  const hidden: Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  let p: Promise<void>;
  try {
    p = compileSafe(gl, scene, camera, 10000, onProgress);
  } finally {
    hidden.forEach((o) => (o.visible = false));
  }
  return p.then(() => {
    const seen = new Set<Texture>();
    scene.traverse((o) => {
      const mats = (o as { material?: Material | Material[] }).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) for (const v of Object.values(m)) if (v instanceof Texture) seen.add(v);
    });
    seen.forEach((t) => gl.initTexture(t));
  });
}

type Idle = (cb: () => void, opts: { timeout: number }) => number;
type IdleWindow = { requestIdleCallback?: Idle; cancelIdleCallback?: (id: number) => void };
/** requestIdleCallback where there is one (Safari has none: a short timeout instead). */
const requestIdle: Idle = (cb, opts) => {
  const w = window as unknown as IdleWindow;
  return w.requestIdleCallback ? w.requestIdleCallback(cb, opts) : window.setTimeout(cb, 200);
};
const cancelIdle = (id: number) => {
  const w = window as unknown as IdleWindow;
  if (w.cancelIdleCallback) w.cancelIdleCallback(id);
  else window.clearTimeout(id);
};

export function RoomBuild({ store, stations, tier, reduced }: { store: WorldStore; stations: readonly StationModule[]; tier: TierName; reduced: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const builder = useMemo(
    () =>
      createRoomBuilder({
        // Only the rooms that have a scene to stand (the robot wall is the workshop's; the zoom plays out of the machine).
        order: roomOrder(reduced).filter((r) => r === "intro:places" || stations.some((s) => s.id === r && s.Scene)),
        rooms,
        filesDone: (r) => assets.progress(roomFiles(r, tier)).done,
        standing: isStanding,
        compile: () => compileAll(gl, scene, camera),
        report: (n, m) => load.count("rooms", n, m),
        done: () => load.set("rooms", 1),
        now: () => performance.now(),
        graceMs: GRACE_MS,
      }),
    [gl, scene, camera, tier, reduced, stations],
  );

  // Under the loader: a step a frame once the hero's shaders are done; let go with the loader.
  useEffect(
    () =>
      load.subscribe(() => {
        if (load.released()) builder.release();
        if (load.status().step === "rooms") invalidate();
      }),
    [builder, invalidate],
  );
  useFrame(() => {
    if (builder.phase() !== "building" || load.status().step !== "rooms") return;
    builder.tick();
    invalidate();
  });

  // After the reveal: what is left, one room per idle moment, each compiled once it stands.
  useEffect(() => {
    let id = 0;
    let live = true;
    let waiting: string | null = null;
    const step = () => {
      if (!live) return;
      if (store.getCoarse().ready && builder.phase() === "done") {
        if (waiting && isStanding(waiting)) {
          const redraw = () => invalidate();
          compileAll(gl, scene, camera).then(redraw, redraw);
          waiting = null;
        }
        const next = builder.idle();
        if (next) {
          waiting = next;
          invalidate();
        }
      }
      id = requestIdle(step, { timeout: 1500 });
    };
    id = requestIdle(step, { timeout: 1500 });
    return () => {
      live = false;
      cancelIdle(id);
    };
  }, [builder, store, gl, scene, camera, invalidate]);

  // The visitor reaching a room: build it now (its files first in the queue; ui/Wait.tsx shows meanwhile).
  useEffect(() => {
    const check = () => {
      const c = store.getCoarse();
      if (!c.ready) return;
      const room = roomAt(c.branch ?? c.current, store.frames.intro.t * INTRO_VH, reduced);
      if (room && !rooms.allowed(room) && assets.progress(roomFiles(room, tier)).done) {
        builder.need(room);
        invalidate();
      }
    };
    // On frames (the visitor moving) and on arrivals (they wait while nothing draws).
    const offs = [store.onFrame(check), store.subscribe(check), assets.subscribe(check)];
    return () => offs.forEach((off) => off());
  }, [builder, store, tier, reduced, invalidate]);
  return null;
}
