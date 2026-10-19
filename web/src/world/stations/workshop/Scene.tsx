// The workshop in 3D: the baked room around everything (unlit, one atlas per piece), the lamps that
// switch it on, the live lights and reflections for the moving parts, the spiral and the library.
// Each file loads in its own Suspense, so pieces appear as they arrive while the lamps sputter.
import { Suspense, useCallback, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useWorld } from "../../core/WorldContext";
import type { StationSceneProps } from "../../core/types";
import { BAKED } from "../../scene/assets";
import { Baked } from "../../scene/Baked";
import { Arm } from "../../scene/Arm";
import { Helix } from "../../scene/Helix";
import { Haze } from "../../scene/Haze";
import { Lamps } from "../../scene/Lamps";
import { Library } from "../../scene/Library";
import { LiveLights } from "../../scene/LiveLights";
import { ENV_INTENSITY } from "../../scene/materials";
import { Pendants } from "../../scene/Pendants";
import { addEnvironment } from "../../scene/power";
import { Ribbon } from "../../scene/Ribbon";
import { N_ITEMS, spiral } from "../../scene/spiral";
import { stepOfT, tOfStep } from "./camera";
import { usePick } from "./send";

/** A small prefiltered room for the glossy plastic to reflect (high and ultra). */
function Reflections() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = env;
    const off = addEnvironment(scene, ENV_INTENSITY);
    return () => {
      off();
      scene.environment = null;
      scene.environmentIntensity = 1;
      env.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** Keeps spiral.step on the camera's step while the workshop browses. */
function StepFollower({ frame }: { frame: StationSceneProps["frame"] }) {
  useFrame(() => {
    spiral.step = frame.current ? Math.min(N_ITEMS - 1, Math.max(-1, stepOfT(frame.t))) : -1;
  });
  return null;
}

export function WorkshopScene({ frame, quality, reduced }: StationSceneProps) {
  const { store } = useWorld();
  const pick = usePick();
  const anisotropy = quality.name === "low" ? 1 : 4;
  // Cartridges answer the pointer only while the workshop (or the machine beside it) is in view,
  // and not while one is open.
  const active = useCallback(
    () => (store.frames.workshop.current || store.frames.machine.current) && store.getCoarse().branch === null && spiral.selected < 0,
    [store],
  );
  const browsing = useCallback(() => store.frames.workshop.current && store.frames.workshop.t >= tOfStep(0) - 0.01, [store]);
  const drift = useCallback(() => quality.dust && !reduced && store.frames.workshop.near, [store, quality, reduced]);
  return (
    <group>
      <Lamps reduced={reduced} />
      <LiveLights />
      {quality.envMap ? <Reflections /> : null}
      {BAKED.map((name) => (
        <Suspense key={name} fallback={null}>
          <Baked name={name} anisotropy={anisotropy} />
        </Suspense>
      ))}
      <Ribbon />
      <Pendants />
      {quality.haze ? <Haze drift={drift} /> : null}
      <Suspense fallback={null}>
        <Helix quality={quality} reduced={reduced} active={active} browsing={browsing} onPick={(k) => pick(k)} />
      </Suspense>
      <Arm quality={quality} reduced={reduced} />
      <StepFollower frame={frame} />
      <Suspense fallback={null}>
        <Library quality={quality} />
      </Suspense>
    </group>
  );
}
