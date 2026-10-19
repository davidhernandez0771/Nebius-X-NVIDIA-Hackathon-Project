// The workshop in 3D: the baked room around everything (unlit, one atlas per piece), the lamps that
// switch it on, and the live lights for the moving parts. Each file loads in its own Suspense, so
// pieces appear as they arrive while the lamps sputter.
import { Suspense } from "react";
import type { StationSceneProps } from "../../core/types";
import { BAKED } from "../../scene/assets";
import { Baked } from "../../scene/Baked";
import { Lamps } from "../../scene/Lamps";
import { LiveLights } from "../../scene/LiveLights";

export function WorkshopScene({ quality, reduced }: StationSceneProps) {
  const anisotropy = quality.name === "low" ? 1 : 4;
  return (
    <group>
      <Lamps reduced={reduced} />
      <LiveLights />
      {BAKED.map((name) => (
        <Suspense key={name} fallback={null}>
          <Baked name={name} anisotropy={anisotropy} />
        </Suspense>
      ))}
    </group>
  );
}
