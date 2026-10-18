// Placeholder geometry until the Blender models arrive: a box with its edges drawn, so its size and
// position read clearly. Swap a station's boxes for its glTF without touching the core.
import { Edges } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { forwardRef } from "react";
import type { Mesh } from "three";
import type { Vec3 } from "./types";

export const PALETTE = {
  body: "#151A21",
  raised: "#1E252E",
  edge: "#5E6A77",
  accent: "#19F5C2",
  issue: "#FFB000",
  violet: "#A78BFA",
  text: "#E6EDF3",
};

interface BoxProps {
  size: Vec3;
  position?: Vec3;
  rotation?: Vec3;
  color?: string;
  edge?: string;
  emissive?: number;
  name?: string;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}

export const Box = forwardRef<Mesh, BoxProps>(function Box(
  { size, position = [0, 0, 0], rotation = [0, 0, 0], color = PALETTE.body, edge = PALETTE.edge, emissive = 0, name, onClick },
  ref,
) {
  return (
    <mesh
      ref={ref}
      name={name}
      position={position as [number, number, number]}
      rotation={rotation as [number, number, number]}
      onClick={onClick}
      castShadow
      receiveShadow
    >
      <boxGeometry args={size as [number, number, number]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissive} roughness={0.85} metalness={0.05} />
      <Edges color={edge} />
    </mesh>
  );
});
