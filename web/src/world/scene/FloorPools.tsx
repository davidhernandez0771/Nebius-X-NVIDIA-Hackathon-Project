// The lamps' pools of light on the floor (lightPools.ts), on every tier: one draw call for both, following
// the lamps' level (power.ts) every frame it renders.
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { POOL_STRENGTH, poolGeometry, poolMaterial } from "./lightPools";
import { power } from "./power";

export function FloorPools() {
  const geometry = useMemo(() => poolGeometry(), []);
  const material = useMemo(() => poolMaterial(), []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame(() => {
    material.uniforms.uStrength.value = POOL_STRENGTH * power.level;
  });
  return <mesh name="floor-pools" geometry={geometry} material={material} raycast={() => null} renderOrder={1} />;
}
