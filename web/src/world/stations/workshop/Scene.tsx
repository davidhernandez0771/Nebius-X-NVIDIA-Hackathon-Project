// The workshop in 3D: the baked room around everything (unlit, one atlas per piece), the lamps that
// switch it on, the live lights and reflections for the moving parts, the spiral and the library.
// Each file loads in its own Suspense, so pieces appear as they arrive while the lamps sputter.
import { Suspense, useCallback, useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useWorld } from "../../core/WorldContext";
import type { StationSceneProps } from "../../core/types";
import { BAKED } from "../../scene/assets";
import { Baked } from "../../scene/Baked";
import { Helix } from "../../scene/Helix";
import { Lamps } from "../../scene/Lamps";
import { Library } from "../../scene/Library";
import { LiveLights } from "../../scene/LiveLights";
import { Ribbon } from "../../scene/Ribbon";
import { useSend } from "./send";

/** A small prefiltered room for the glossy plastic to reflect (high and ultra). */
function Reflections() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene]);
  return null;
}

export function WorkshopScene({ quality, reduced }: StationSceneProps) {
  const { store } = useWorld();
  const send = useSend();
  const anisotropy = quality.name === "low" ? 1 : 4;
  // Cartridges answer the pointer only while the workshop (or the machine beside it) is in view.
  const active = useCallback(() => store.frames.workshop.current || store.frames.machine.current, [store]);
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
      <Ribbon quality={quality} />
      <Suspense fallback={null}>
        <Helix quality={quality} active={active} onSend={send} />
      </Suspense>
      <Suspense fallback={null}>
        <Library quality={quality} />
      </Suspense>
    </group>
  );
}
