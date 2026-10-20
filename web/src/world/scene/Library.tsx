// The library shelves along the walls: 442 cartridges from cartridge_lod.glb (a beveled box and the
// label), two InstancedMeshes in all, standing spine-out like books (libraryMatrix). They don't move
// or take clicks; each gets a repeatable shell tint and label tile so the wall reads as a collection,
// not a pattern.
import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { QualityTier } from "../core/quality";
import { CARTRIDGE_LOD_URL } from "./assets";
import { cartridgeParts, libraryMatrix } from "./cartridge";
import { GRAPHITE } from "./Helix";
import { LIBRARY_TILES, TILE_COUNT } from "./labels";
import { LIBRARY } from "./layout";
import { liveMaterial, trackLive } from "./materials";
import { markLoaded } from "./power";

const N = LIBRARY.length;
const SHELLS: readonly (readonly [number, number, number])[] = [GRAPHITE, GRAPHITE, GRAPHITE, [0.82, 0.82, 0.8], [0.3, 0.3, 0.32]];

/** A repeatable pick per slot (no Math.random, so every visit shows the same wall). */
export function libraryPick(i: number): { shell: number; tile: number } {
  const h = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const tile = h(2) < 0.7 ? LIBRARY_TILES[Math.floor(h(3) * LIBRARY_TILES.length)] : Math.floor(h(4) * (TILE_COUNT - LIBRARY_TILES.length));
  return { shell: Math.floor(h(1) * SHELLS.length), tile };
}

export function Library({ quality }: { quality: QualityTier }) {
  const gltf = useGLTF(CARTRIDGE_LOD_URL, false);
  const invalidate = useThree((s) => s.invalidate);
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);

  const parts = useMemo(() => {
    const picks = LIBRARY.map((_, i) => libraryPick(i));
    // The far shelves never need reflections: Lambert on every tier.
    const flat = { ...quality, name: "low" as const };
    return cartridgeParts(gltf.scene).map((p) => {
      const isLabel = p.name.startsWith("label");
      const geometry = isLabel ? p.geometry.clone() : p.geometry;
      // At library distance a label is a few pixels: sampling the shared atlas there blends
      // neighbouring labels into sparkling stripes as the view moves. A plain paper label instead.
      const material = isLabel ? liveMaterial(p.source, flat, { color: "#a9a59a" }) : liveMaterial(p.source, flat, { color: "#ffffff" });
      return { name: p.name, geometry, material, isLabel, picks };
    });
  }, [gltf, quality]);

  useEffect(() => {
    const releases = parts.map((p) => trackLive(p.material));
    markLoaded(CARTRIDGE_LOD_URL);
    const c = new THREE.Color();
    const m4 = new THREE.Matrix4();
    meshes.current.forEach((m, k) => {
      if (!m) return;
      const part = parts[k];
      LIBRARY.forEach((s, i) => {
        m.setMatrixAt(i, libraryMatrix(s, m4));
        if (!part.isLabel) m.setColorAt(i, c.setRGB(...SHELLS[part.picks[i].shell], THREE.LinearSRGBColorSpace));
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    });
    invalidate();
    return () => releases.forEach((r) => r());
  }, [parts, invalidate]);

  return (
    <group name="library">
      {parts.map((p, k) => (
        <instancedMesh key={p.name} ref={(m) => (meshes.current[k] = m)} args={[p.geometry, p.material, N]} raycast={() => null} matrixAutoUpdate={false} />
      ))}
    </group>
  );
}
