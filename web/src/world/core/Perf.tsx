// The canvas's housekeeping, all inside the r3f loop:
// - HudProbe: counts the whole frame (every pass) for the HUD, a few times a second;
// - AutoTune: after the intro, measures frames and asks for a tier change (autotune.ts);
// - Pause: no frames at all while the tab is hidden;
// - WarmUp: compiles the shaders of whatever streamed in (the workshop after the loader), before the
//   camera gets there, so the first look at it doesn't hitch.
import { useEffect, useMemo, useRef } from "react";
import { useProgress } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { WebGLRenderer } from "three";
import { createTuner } from "./autotune";
import { hud } from "./hud";
import type { TierName } from "./quality";
import type { WorldStore } from "./store";

/** Seconds after the loader before the auto-tune starts: the logo has gathered (intro GATHER_S). */
const TUNE_AFTER_S = 2.4;

export function HudProbe() {
  const gl = useThree((s) => s.gl);
  const st = useRef({ t: 0, frames: 0 });
  useEffect(() => {
    gl.info.autoReset = false;
    const ctx = gl.getContext();
    const ext = ctx.getExtension("WEBGL_debug_renderer_info");
    hud.gpu = String(ctx.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : ctx.RENDERER) ?? "");
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  // First in the frame: read the last frame's totals, then start counting this one.
  useFrame((_, delta) => {
    const s = st.current;
    s.t += delta;
    s.frames++;
    if (s.t > 0.25) {
      hud.fps = Math.round(s.frames / s.t);
      s.t = 0;
      s.frames = 0;
      const r = gl.info.render;
      hud.calls = r.calls;
      hud.tris = r.triangles;
      hud.points = r.points;
      hud.textures = gl.info.memory.textures;
      hud.geometries = gl.info.memory.geometries;
      hud.programs = (gl.info as WebGLRenderer["info"] & { programs?: unknown[] }).programs?.length ?? 0;
      hud.dpr = gl.getPixelRatio();
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      hud.heapMb = mem ? Math.round(mem.usedJSHeapSize / 1e6) : null;
    }
    gl.info.reset();
  }, -2);
  return null;
}

export function AutoTune({ store, tier, onTier }: { store: WorldStore; tier: TierName; onTier: (t: TierName) => void }) {
  const tuner = useMemo(() => createTuner(tier), [tier]);
  const st = useRef<{ readyAt: number | null }>({ readyAt: null });
  useEffect(() => {
    hud.tune = "auto";
  }, []);
  useFrame(({ clock }, delta) => {
    if (tuner.done) return;
    if (!store.getCoarse().ready) return;
    const now = clock.elapsedTime;
    st.current.readyAt ??= now;
    if (now - st.current.readyAt < TUNE_AFTER_S) return;
    const next = tuner.sample(delta * 1000);
    if (next) onTier(next);
    if (tuner.done) hud.tune = `auto → ${tuner.tier}`;
  });
  return null;
}

export function Pause() {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const on = () => {
      if (document.hidden) setFrameloop("never");
      else {
        setFrameloop("demand");
        invalidate();
      }
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [setFrameloop, invalidate]);
  return null;
}

export function WarmUp() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let last = -1;
    let live = true;
    const r = gl as WebGLRenderer & { compileAsync?: (s: unknown, c: unknown) => Promise<unknown> };
    const warm = ({ active, loaded }: { active: boolean; loaded: number }) => {
      if (active || loaded === last || !r.compileAsync) return;
      last = loaded;
      // After React has mounted what arrived.
      setTimeout(() => live && r.compileAsync!(scene, camera).then(() => live && invalidate(), () => {}), 0);
    };
    warm(useProgress.getState());
    const off = useProgress.subscribe(warm);
    return () => {
      live = false;
      off();
    };
  }, [gl, scene, camera, invalidate]);
  return null;
}
