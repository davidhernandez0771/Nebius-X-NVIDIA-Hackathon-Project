// What is only drawn while the camera is under the ceiling. From above, the roof is an effect, not
// Blender's slab: the intro's particle lattice and the skylight ring over a dark void, as Active
// Theory's floors are (docs/design/references/activetheory.md). The dive cuts inside below the
// ceiling (stations/workshop/dive.ts), so the room is first seen from inside.
// Only meshes go in here: a light leaving the scene would make every lit material recompile at the cut.
import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";

/** The ceiling's top (room.glb's ceiling is at 14.4) plus a margin: above this the room is hidden. */
export const ROOF_HIDE_Y = 15;

function useRoofSide(below: boolean) {
  const ref = useRef<Group>(null);
  // After the camera rig (priority -1) has placed this frame's camera.
  useFrame(({ camera }) => {
    if (ref.current) ref.current.visible = camera.position.y < ROOF_HIDE_Y === below;
  });
  return ref;
}

export function BelowRoof({ children }: { children: ReactNode }) {
  return <group ref={useRoofSide(true)}>{children}</group>;
}

/** The other side: what stands in for the roof while the camera is above it (the skylight's well). */
export function AboveRoof({ children }: { children: ReactNode }) {
  return <group ref={useRoofSide(false)}>{children}</group>;
}
