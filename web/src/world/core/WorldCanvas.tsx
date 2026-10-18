// The one react-three-fiber canvas, mounted once for the whole journey. It renders on demand: the
// rig asks for frames while the camera moves, the scroll asks for one per scroll event, and an idle
// world draws nothing. Each station's Scene sits in its own group, Suspense and error boundary, so
// one module loading or failing never blanks the others.
import { Component, Suspense, useRef, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { CameraRig } from "./CameraRig";
import { WORLD_BG } from "./layout";
import type { QualityTier } from "./quality";
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

export default function WorldCanvas({
  store,
  stations,
  quality,
  reduced,
  onCut,
}: {
  store: WorldStore;
  stations: readonly StationModule[];
  quality: QualityTier;
  reduced: boolean;
  onCut: () => void;
}) {
  const first = store.rails[0];
  return (
    <Canvas
      className="world-canvas"
      style={{ position: "fixed", inset: 0 }}
      frameloop="demand"
      dpr={quality.dpr}
      shadows={quality.shadows}
      gl={{ antialias: quality.antialias, powerPreference: quality.powerPreference, alpha: false }}
      camera={{ fov: 40, near: 0.1, far: 220, position: first.anchor as [number, number, number] }}
      aria-hidden="true"
      data-quality={quality.name}
    >
      <color attach="background" args={[WORLD_BG]} />
      <fog attach="fog" args={[WORLD_BG, 16, 58]} />
      <hemisphereLight args={["#E6EDF3", "#151A21", 1.1]} />
      <directionalLight position={[8, 18, 10]} intensity={1.6} castShadow={quality.shadows} shadow-mapSize={[1024, 1024]} />
      <CameraRig store={store} stations={stations} reduced={reduced} onCut={onCut} />
      {stations
        .filter((s) => s.Scene)
        .map((s) => (
          <StationGroup key={s.id} station={s} frame={store.frames[s.id]} quality={quality} reduced={reduced} />
        ))}
    </Canvas>
  );
}
