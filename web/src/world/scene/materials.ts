// Materials for the live parts (cartridges, the machine's moving parts), picked by tier from the
// GLB's own: low gets Lambert (no reflections), high a standard material with the small environment,
// ultra keeps the clearcoat (MeshPhysicalMaterial). The label's atlas tile comes per instance from
// an `aTile` attribute (offset xy, scale zw), patched into the shader once.
import * as THREE from "three";
import type { QualityTier } from "../core/quality";

/** How much the environment reflects at full power (scene.environmentIntensity; the lamps scale it, power.ts). */
export const ENV_INTENSITY = 0.22;

type Src = THREE.MeshStandardMaterial & Partial<Pick<THREE.MeshPhysicalMaterial, "clearcoat" | "clearcoatRoughness">>;

export function liveMaterial(src: THREE.Material, tier: QualityTier, extra: { map?: THREE.Texture | null; color?: THREE.ColorRepresentation; transparent?: boolean; opacity?: number } = {}): THREE.Material {
  const s = src as Src;
  const color = extra.color !== undefined ? new THREE.Color(extra.color) : s.color?.clone() ?? new THREE.Color(1, 1, 1);
  const map = extra.map !== undefined ? extra.map : s.map ?? null;
  const transparent = extra.transparent ?? false;
  const opacity = extra.opacity ?? 1;
  const common = { color, map, transparent, opacity, depthWrite: !transparent, name: s.name };
  if (tier.name === "low") return new THREE.MeshLambertMaterial(common);
  const pbr = { ...common, roughness: s.roughness ?? 0.5, metalness: s.metalness ?? 0 };
  const m = tier.physical && (s.clearcoat ?? 0) > 0 ? new THREE.MeshPhysicalMaterial({ ...pbr, clearcoat: s.clearcoat, clearcoatRoughness: s.clearcoatRoughness ?? 0.05 }) : new THREE.MeshStandardMaterial(pbr);
  return m;
}

/** The release for a live material (its reflections follow the lamps through the scene, power.ts). */
export function trackLive(m: THREE.Material): () => void {
  return () => m.dispose();
}

/** Let an instanced material read its map through the per-instance atlas tile `aTile`. */
export function withTiles<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aTile;")
      // The label mesh's v runs top to bottom (the atlas is uploaded with flipY): flip it into the tile.
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = aTile.xy + vec2(vMapUv.x, 1.0 - vMapUv.y) * aTile.zw;\n#endif");
  };
  m.customProgramCacheKey = () => "world-tiles-v";
  return m;
}
