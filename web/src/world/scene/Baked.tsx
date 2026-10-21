// One baked piece of the workshop (room, shelves, pedestal, bench, desk, machine body): the mesh
// `baked_<name>` from its GLB, drawn with its atlas on an unlit MeshBasicMaterial, so no live light
// touches it and it costs one texture lookup per pixel. The lamps scale its colour (power.ts).
// Each baked GLB also carries a stray copy of the bench's parts (bx_B_*): only baked_<name> is used.
import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { bakedUrl, type BakedName } from "./assets";
import { addBaked, markLoaded } from "./power";

/** `cut`: keeps part of the baked mesh (the machine body under the new machine keeps only its cable, machineV2.ts). */
export function Baked({ name, anisotropy = 1, cut }: { name: BakedName; anisotropy?: number; cut?: (g: THREE.BufferGeometry) => THREE.BufferGeometry }) {
  const url = bakedUrl(name);
  const gltf = useGLTF(url, false);
  const invalidate = useThree((s) => s.invalidate);
  const { geometry, material } = useMemo(() => {
    const src = gltf.scene.getObjectByName(`baked_${name}`);
    if (!(src instanceof THREE.Mesh)) throw new Error(`world: ${url} has no mesh baked_${name}`);
    const map = (src.material as THREE.MeshStandardMaterial).map;
    if (map) {
      map.anisotropy = anisotropy;
      map.needsUpdate = true;
    }
    // The atlas is already the final picture: no tone mapping on top of it.
    const material = new THREE.MeshBasicMaterial({ map, toneMapped: false, side: THREE.DoubleSide });
    const whole = src.geometry as THREE.BufferGeometry;
    const geometry = cut ? cut(whole) : whole;
    // A cut may tint its parts per vertex (the machine body's cable, machineV2.ts): the atlas times it.
    material.vertexColors = !!geometry.getAttribute("color");
    return { geometry, material };
  }, [gltf, name, url, anisotropy, cut]);

  useEffect(() => {
    const off = addBaked(material);
    markLoaded(url);
    invalidate();
    return () => {
      off();
      material.dispose();
    };
  }, [material, url, invalidate]);
  // A cut is this component's own geometry (the whole one is the cached file's).
  useEffect(() => () => void (cut && geometry.dispose()), [geometry, cut]);

  return <mesh name={`baked:${name}`} geometry={geometry} material={material} matrixAutoUpdate={false} />;
}
