// Machine (T7, placeholder): a GPU-shaped box. Over its dwell the chosen cartridge drops into the
// slot, then the projection lights above it, in PROJECTION, where the zoom will fly in.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_CARTRIDGE, MACHINE_ANCHOR, MACHINE_VIEW, PROJECTION } from "../../core/layout";
import { Box, PALETTE } from "../../core/Placeholder";
import { smoother } from "../../core/rail";
import { useWorldState } from "../../core/WorldContext";
import type { StationModule, StationOverlayProps, StationSceneProps } from "../../core/types";
import { STILLS } from "../../scene/assets";

/** A placeholder screen for the hologram: the cartridge's name on the app's ground. */
function useScreenTexture(label: string): THREE.CanvasTexture | null {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 288;
    const g = c.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#07090C";
    g.fillRect(0, 0, 512, 288);
    g.strokeStyle = PALETTE.accent;
    g.lineWidth = 4;
    g.strokeRect(10, 10, 492, 268);
    g.fillStyle = PALETTE.text;
    g.font = "600 56px system-ui, sans-serif";
    g.textBaseline = "middle";
    g.fillText(label, 44, 144);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [label]);
}

function Scene({ frame }: StationSceneProps) {
  const label = useWorldState((c) => (c.cartridge ?? DEFAULT_CARTRIDGE).label);
  const tex = useScreenTexture(label);
  const cart = useRef<THREE.Group>(null);
  const screen = useRef<THREE.MeshBasicMaterial>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const plug = smoother(frame.t / 0.45);
    const light = smoother((frame.t - 0.45) / 0.4);
    if (cart.current) cart.current.position.y = 2.9 - plug * 1.25;
    if (screen.current) screen.current.opacity = light * 0.92;
    if (beam.current) beam.current.opacity = light * 0.12;
  });
  const [cx, cy, cz] = PROJECTION.center;
  return (
    <group>
      <Box size={[3.8, 0.5, 1.8]} position={[0, 0.25, 0]} color={PALETTE.raised} />
      <Box size={[3.4, 0.8, 1.4]} position={[0, 0.9, 0]} color={PALETTE.body} />
      {[-0.85, 0.85].map((x) => (
        <mesh key={x} position={[x, 0.9, 0.71]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.32, 0.32, 0.04, 24]} />
          <meshStandardMaterial color="#0E1217" />
        </mesh>
      ))}
      <Box size={[1.3, 0.12, 1.0]} position={[0, 1.36, 0]} color="#0E1217" />
      <group ref={cart}>
        <Box size={[1.1, 0.7, 0.9]} color={PALETTE.accent} emissive={0.35} />
      </group>
      <mesh position={[cx, (1.4 + cy) / 2, cz]}>
        <cylinderGeometry args={[PROJECTION.width * 0.48, 0.5, cy - 1.4 - PROJECTION.height / 2, 4, 1, true]} />
        <meshBasicMaterial ref={beam} color={PALETTE.accent} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[cx, cy, cz]}>
        <planeGeometry args={[PROJECTION.width, PROJECTION.height]} />
        <meshBasicMaterial ref={screen} map={tex} transparent opacity={0} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Overlay(_: StationOverlayProps) {
  const label = useWorldState((c) => (c.cartridge ?? DEFAULT_CARTRIDGE).label);
  return (
    <div className="world-panel">
      <h2 className="world-h">Machine</h2>
      <p className="world-lede">{label} plugs in. Keep scrolling to go into the projection.</p>
    </div>
  );
}

const machine: StationModule = {
  id: "machine",
  still: STILLS.machine,
  title: "Machine",
  owner: "T7",
  kind: "rail",
  anchor: MACHINE_ANCHOR,
  travel: 0.8,
  length: 1.6,
  // Ends exactly on MACHINE_VIEW, where the zoom starts.
  camera: (t) => {
    const u = smoother(t);
    const [px, py, pz] = MACHINE_VIEW.position;
    return { position: [px + 1.6 * (1 - u), py - 0.2 * (1 - u), pz + 0.8 * (1 - u)], target: MACHINE_VIEW.target, fov: MACHINE_VIEW.fov };
  },
  rest: MACHINE_VIEW,
  Scene,
  Overlay,
};

export default machine;
