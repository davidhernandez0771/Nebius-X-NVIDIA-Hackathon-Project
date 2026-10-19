// The canvas's housekeeping, all inside the r3f loop:
// - HudProbe: counts the whole frame (every pass) for the HUD, a few times a second;
// - AutoTune: after the intro, measures frames and asks for a tier change (autotune.ts);
// - Pause: no frames at all while the tab is hidden;
// - WarmUp: compiles the shaders of whatever streamed in (the workshop after the loader), before the
//   camera gets there, so the first look at it doesn't hitch.
import { useEffect, useMemo, useRef } from "react";
import { useProgress } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Texture, type Material, type WebGLRenderer } from "three";
import { idle } from "./activity";
import { createTuner } from "./autotune";
import { hud } from "./hud";
import type { QualityTier, TierName } from "./quality";
import { createScaler, targetDpr } from "./resolution";
import type { WorldStore } from "./store";

/** The auto-tune starts this long after the last file finished streaming in (uploads, compiles). */
const TUNE_AFTER_LOAD_MS = 3000;

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
  // When streaming last went quiet (performance.now), or null while files are still arriving.
  const settled = useRef<number | null>(null);
  useEffect(() => {
    hud.tune = "auto";
    const on = ({ active }: { active: boolean }) => {
      settled.current = active ? null : performance.now();
    };
    on(useProgress.getState());
    return useProgress.subscribe(on);
  }, []);
  useFrame((_, delta) => {
    if (tuner.done || idle()) return;
    // Not while the workshop streams in: uploads and compiles are hitches, not a slow GPU.
    if (!store.getCoarse().ready || settled.current === null || performance.now() - settled.current < TUNE_AFTER_LOAD_MS) return;
    const next = tuner.sample(delta * 1000);
    if (next) onTier(next);
    if (tuner.done) hud.tune = `auto → ${tuner.tier}`;
  });
  return null;
}

/**
 * The canvas's pixel ratio: the tier's cap held to its pixel budget (resolution.ts), times a live
 * scale that drops when frames run slow and recovers with headroom. Calls onDpr only on a change.
 */
export function Resolution({ quality, onDpr }: { quality: QualityTier; onDpr: (dpr: number) => void }) {
  const size = useThree((s) => s.size);
  const scaler = useMemo(() => createScaler(), [quality]);
  const st = useRef({ scale: 1, sent: 0 });
  const push = (scale: number) => {
    st.current.scale = scale;
    const dpr = targetDpr(quality, size.width, size.height, window.devicePixelRatio || 1, scale);
    hud.scale = scale;
    if (dpr !== st.current.sent) {
      st.current.sent = dpr;
      onDpr(dpr);
    }
  };
  useEffect(() => push(scaler.scale), [quality, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, delta) => {
    // Idle frames come at 30 fps on purpose (activity.ts): not a sign of a slow GPU.
    if (idle()) return;
    const next = scaler.sample(delta * 1000);
    if (next !== null) push(next);
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
      // After React has mounted what arrived: compile its shaders and upload its textures now, so the
      // first frame that shows it doesn't stall on either.
      setTimeout(
        () =>
          live &&
          r.compileAsync!(scene, camera).then(() => {
            if (!live) return;
            const seen = new Set<Texture>();
            scene.traverse((o) => {
              const mats = (o as { material?: Material | Material[] }).material;
              for (const m of Array.isArray(mats) ? mats : mats ? [mats] : [])
                for (const v of Object.values(m)) if (v instanceof Texture && !seen.has(v)) seen.add(v);
            });
            seen.forEach((t) => gl.initTexture(t));
            invalidate();
          }, () => {}),
        0,
      );
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
