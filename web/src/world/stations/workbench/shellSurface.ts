// The bench's shell finishes, drawn into the tier's own material (Standard on high and ultra, Lambert
// on low) rather than made new: cartridge.glb's shell has no UVs, so each pattern is worked out from the
// object-space position, on the face the normal points along. Brushed metal streaks along the length;
// carbon is a 2×2 twill weave; ceramic a glaze with a fine speckle. The roughness and metalness come
// from the finish (saved.ts FINISHES) through uniforms, or per instance (`aFinish`) for the row of
// blanks, which is one instanced draw. `uSweep` runs the finish's light across the shell (finale.ts).
// The label's print head (`uWipe`) shows its print from the top down, with blank paper below the head.
import * as THREE from "three";
import { finishOf, type FinishId, type Surface } from "../../scene/saved";

const SURFACE: Record<Surface, number> = { none: 0, brushed: 1, weave: 2, speckle: 3 };

export interface FinishUniforms {
  uRough: { value: number };
  uMetal: { value: number };
  uSurface: { value: number };
  uSweep: { value: number };
}

const common = /* glsl */ `
  varying vec3 vObjPos;
  varying vec3 vObjN;
  #ifdef FINISH_INSTANCED
    varying vec4 vFinish;
  #else
    uniform float uRough, uMetal, uSurface;
  #endif
  uniform float uSweep;
  float shHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float shHash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  // The face's own 2D coordinates: the two axes across the normal's main one.
  vec2 shFace() {
    vec3 n = abs(vObjN);
    return n.z >= n.x && n.z >= n.y ? vObjPos.xy : n.x >= n.y ? vObjPos.zy : vObjPos.xz;
  }
  // How a pattern tints the colour (rgb factor) and moves the roughness.
  vec2 shPattern(float kind) {
    if (kind < 0.5) return vec2(1.0, 0.0);
    if (kind < 1.5) {
      // Brushed: fine streaks along x, a few stronger ones.
      float row = floor(vObjPos.y * 520.0 + vObjPos.z * 520.0);
      float s = shHash(vec2(row, 3.0)) * 0.7 + shHash(vec2(floor(row / 7.0), 9.0)) * 0.3;
      return vec2(0.88 + 0.2 * s, (s - 0.5) * 0.16);
    }
    if (kind < 2.5) {
      // Carbon: a 2×2 twill, each tow lit across its width.
      vec2 p = shFace() * 15.0;
      vec2 c = floor(p);
      bool warp = mod(c.x + c.y, 4.0) < 2.0;
      float across = warp ? fract(p.x) : fract(p.y);
      float lit = sin(across * 3.14159);
      return vec2(mix(0.45, 1.35, lit * lit) * (warp ? 1.0 : 0.82), (warp ? -0.06 : 0.08));
    }
    // Ceramic: a glaze with a fine speckle.
    float speck = step(0.986, shHash3(floor(vObjPos * 210.0)));
    float cloud = shHash3(floor(vObjPos * 24.0)) * 0.06;
    return vec2(1.0 - speck * 0.5 - cloud, speck * 0.3);
  }
  // The light that crosses the shell at the finish: a soft diagonal band.
  float shSweep() {
    if (uSweep <= 0.0 || uSweep >= 1.0) return 0.0;
    float s = (vObjPos.y + vObjPos.x * 0.45) / 1.55;
    float c = mix(-1.25, 1.25, uSweep);
    return exp(-pow((s - c) / 0.11, 2.0));
  }
`;

/**
 * Patches a shell material with the finishes. Instanced: each instance's roughness, metalness and
 * pattern come from `aFinish` (r, m, surface, unused); otherwise from the returned uniforms.
 */
export function withFinish<M extends THREE.Material>(m: M, instanced = false): { material: M; uniforms: FinishUniforms } {
  const uniforms: FinishUniforms = { uRough: { value: 0.5 }, uMetal: { value: 0 }, uSurface: { value: 0 }, uSweep: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    if (instanced) sh.defines = { ...sh.defines, FINISH_INSTANCED: "" };
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vObjPos;
        varying vec3 vObjN;
        #ifdef FINISH_INSTANCED
          attribute vec4 aFinish;
          varying vec4 vFinish;
        #endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vObjPos = position;
        vObjN = normal;
        #ifdef FINISH_INSTANCED
          vFinish = aFinish;
        #endif`,
      );
    const kind = instanced ? "vFinish.z" : "uSurface";
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${common}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n  vec2 shP = shPattern(${kind});\n  diffuseColor.rgb *= shP.x;`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n  roughnessFactor = clamp(${instanced ? "vFinish.x" : "uRough"} + shP.y, 0.03, 1.0);`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n  metalnessFactor = ${instanced ? "vFinish.y" : "uMetal"};`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(0.95, 1.0, 0.98) * shSweep() * 2.2;`);
  };
  m.customProgramCacheKey = () => (instanced ? "bench-finish-i" : "bench-finish");
  return { material: m, uniforms };
}

/** A finish's numbers for the uniforms (and the material's own see-through). */
export function applyFinish(m: THREE.Material & { color: THREE.Color; opacity: number; transparent: boolean; depthWrite: boolean }, u: FinishUniforms, id: FinishId): void {
  const f = finishOf(id);
  u.uRough.value = f.roughness;
  u.uMetal.value = f.metalness;
  u.uSurface.value = SURFACE[f.surface];
  const clear = f.opacity < 1;
  if (m.transparent !== clear) {
    m.transparent = clear;
    m.depthWrite = !clear;
    m.needsUpdate = true;
  }
  m.opacity = f.opacity;
}

/** Per-instance `aFinish` values for a finish. */
export const finishAttribute = (id: FinishId): [number, number, number, number] => {
  const f = finishOf(id);
  return [f.roughness, f.metalness, SURFACE[f.surface], 0];
};

export interface WipeUniforms {
  uWipe: { value: number };
}

const PAPER = new THREE.Color("#DCD9D1");

/**
 * Patches a label material with the print head: the label shows its print from the top down to
 * `uWipe` (0 blank paper, 1 all printed), with a thin bright line at the head while it runs.
 */
export function withPrintHead<M extends THREE.Material>(m: M): { material: M; uniforms: WipeUniforms } {
  const uniforms: WipeUniforms = { uWipe: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWipe = uniforms.uWipe;
    sh.uniforms.uPaper = { value: PAPER.clone().convertSRGBToLinear() };
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uWipe;\nuniform vec3 uPaper;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
          // The map's v is 1 at the label's top (Scene.tsx flips it): the head runs from 1 down to 0.
          float headAt = 1.0 - uWipe;
          float printed = step(headAt, vMapUv.y);
          diffuseColor.rgb = mix(uPaper, diffuseColor.rgb, printed);
          float head = (uWipe > 0.0 && uWipe < 1.0) ? exp(-pow((vMapUv.y - headAt) / 0.012, 2.0)) : 0.0;
          diffuseColor.rgb += vec3(0.35, 1.0, 0.85) * head * 0.9;
        #endif`,
      );
  };
  m.customProgramCacheKey = () => "bench-print-head";
  return { material: m, uniforms };
}
