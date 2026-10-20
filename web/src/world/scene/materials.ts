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

/**
 * How much of a pixel a glowing line covers: `d` is the distance from the line's centre, `px` one
 * pixel in the same unit (the shader's screen derivative) and `halfW` the line's half width. The thin
 * teal rings were hard geometry a pixel or two wide, and with the hub's mouse look moving the camera by
 * millimetres their edges stepped on and off whole pixels: they crawled. This one ramps over a pixel
 * at each edge, and a line thinner than a pixel is drawn a pixel wide and fainter instead of breaking
 * up, so the light a line gives off doesn't change as it slides between pixel centres.
 */
export function softLine(d: number, px: number, halfW: number): number {
  const h = Math.max(halfW, 0.5 * px);
  return Math.min(1, Math.max(0, (h - Math.abs(d)) / px + 0.5)) * (halfW / h);
}

/** softLine in GLSL (the same arithmetic). */
export const SOFT_LINE_GLSL = /* glsl */ `
float softLine(float d, float px, float halfW) {
  float h = max(halfW, 0.5 * px);
  return clamp((h - abs(d)) / px + 0.5, 0.0, 1.0) * (halfW / h);
}
float pixelOf(float v) { return max(length(vec2(dFdx(v), dFdy(v))), 1e-6); }
`;

/**
 * Turn a MeshBasicMaterial into a soft-edged line: the geometry carries `aAcross`, the distance from
 * the line's centre in half widths (±1 at the line's edges), and reaches past them (to ±3, say) so the
 * edge ramp and a sub-pixel line's one-pixel width have room. Its colour stays the material's (the
 * lamps still drive it, power.ts); it turns transparent and stops writing depth.
 */
export function withSoftEdge<M extends THREE.MeshBasicMaterial>(m: M): M {
  m.transparent = true;
  m.depthWrite = false;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aAcross;\nvarying float vAcross;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAcross = aAcross;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying float vAcross;\n${SOFT_LINE_GLSL}`)
      .replace("#include <alphamap_fragment>", "#include <alphamap_fragment>\ndiffuseColor.a *= softLine(vAcross, pixelOf(vAcross), 1.0);");
  };
  m.customProgramCacheKey = () => "world-soft-edge";
  return m;
}
