// The only real-time lights, for the moving parts (cartridges, fans, the plugged-in cartridge): a
// cool sky fill and a key from the lamps overhead, so they sit in the baked room's light. They follow
// the lamps' level (power.ts). The baked room ignores them (unlit material).
import { useEffect, useRef } from "react";
import type { DirectionalLight, HemisphereLight } from "three";
import { addLight } from "./power";

export const LIGHT = { sky: 0.9, key: 1.5 } as const;

export function LiveLights() {
  const sky = useRef<HemisphereLight>(null);
  const key = useRef<DirectionalLight>(null);
  useEffect(() => {
    const offs = [sky.current && addLight(sky.current, LIGHT.sky), key.current && addLight(key.current, LIGHT.key)];
    return () => offs.forEach((off) => off?.());
  }, []);
  return (
    <>
      <hemisphereLight ref={sky} args={["#C9D3DC", "#0B0E12", 0]} />
      <directionalLight ref={key} position={[2, 16, 9]} intensity={0} />
    </>
  );
}
