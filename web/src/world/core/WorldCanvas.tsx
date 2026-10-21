// The one react-three-fiber canvas, mounted once for the whole journey. It renders on demand: the
// rig asks for frames while the camera moves, the scroll asks for one per scroll event, and an idle
// world draws nothing. Each station's Scene sits in its own group, Suspense and error boundary, so
// one module loading or failing never blanks the others.
import { Component, Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { setIdleFps } from "./activity";
import { CameraRig } from "./CameraRig";
import { WORLD_BG } from "./layout";
import { AutoTune, HudProbe, Pause, Resolution, WarmUp } from "./Perf";
import { PostFX } from "./PostFX";
import type { QualityTier, TierName } from "./quality";
import { targetDpr } from "./resolution";
import type { WorldStore } from "./store";
import type { StationFrame, StationModule } from "./types";

class StationBoundary extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error(`world: station "${this.props.id}" failed to render`, error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function StationGroup({ station, frame, quality, reduced }: { station: StationModule; frame: StationFrame; quality: QualityTier; reduced: boolean }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.visible = frame.near;
  });
  const Scene = station.Scene!;
  return (
    <group ref={ref} position={station.anchor as [number, number, number]} name={`station:${station.id}`}>
      <StationBoundary id={station.id}>
        <Suspense fallback={null}>
          <Scene frame={frame} quality={quality} reduced={reduced} />
        </Suspense>
      </StationBoundary>
    </group>
  );
}

/**
 * The stations' Scenes. Until the loader is done only the first rail station (the intro) is mounted,
 * so its shaders compile under the loader and the workshop's files stream in after the first frame.
 */
function Stations({ store, stations, quality, reduced }: { store: WorldStore; stations: readonly StationModule[]; quality: QualityTier; reduced: boolean }) {
  const ready = useSyncExternalStore(store.subscribe, () => store.getCoarse().ready);
  const first = store.rails[0].id;
  return (
    <>
      {stations
        .filter((s) => s.Scene && (ready || s.id === first))
        .map((s) => (
          <StationGroup key={s.id} station={s} frame={store.frames[s.id]} quality={quality} reduced={reduced} />
        ))}
    </>
  );
}

export default function WorldCanvas({
  store,
  stations,
  quality,
  reduced,
  onCut,
  tune = false,
  onTier = () => {},
}: {
  store: WorldStore;
  stations: readonly StationModule[];
  quality: QualityTier;
  reduced: boolean;
  onCut: () => void;
  /** Run the auto-tune (not when the URL or an earlier visit chose the tier). */
  tune?: boolean;
  onTier?: (t: TierName) => void;
}) {
  const first = store.rails[0];
  // The pixel ratio lives here, so a re-render of the canvas keeps the live value (r3f re-applies it).
  const [dpr, setDpr] = useState(() => targetDpr(quality, window.innerWidth, window.innerHeight, window.devicePixelRatio || 1));
  // Idle loops (activity.ts): 60 fps on high and ultra, 30 on low.
  useEffect(() => setIdleFps(quality.name === "low" ? 30 : 60), [quality.name]);
  return (
    <Canvas
      className="world-canvas"
      style={{ position: "fixed", inset: 0 }}
      frameloop="demand"
      dpr={dpr}
      shadows={quality.shadows}
      gl={{ antialias: quality.antialias, powerPreference: quality.powerPreference, alpha: false }}
      camera={{ fov: 40, near: 0.1, far: 220, position: first.anchor as [number, number, number] }}
      aria-hidden="true"
      data-quality={quality.name}
      onCreated={(state) => {
        // Dev only: the r3f state for the console and the perf measurement (web/scripts/world-perf.mjs).
        if (import.meta.env.DEV) (window as unknown as { __world3d?: unknown }).__world3d = state;
      }}
    >
      <color attach="background" args={[WORLD_BG]} />
      {/* The room is ~44 m across: fog only reaches its far walls, thicker with ultra's haze. */}
      <fog attach="fog" args={quality.haze ? [WORLD_BG, 24, 95] : [WORLD_BG, 34, 120]} />
      {/* No lights here: the room's light is baked, and the workshop's live lights follow its lamps. */}
      <CameraRig store={store} stations={stations} reduced={reduced} onCut={onCut} />
      <Stations store={store} stations={stations} quality={quality} reduced={reduced} />
      {quality.post ? <PostFX store={store} quality={quality} reduced={reduced} /> : null}
      <Resolution quality={quality} onDpr={setDpr} />
      <HudProbe />
      {tune ? <AutoTune store={store} tier={quality.name} onTier={onTier} /> : null}
      <Pause />
      <WarmUp />
    </Canvas>
  );
}
