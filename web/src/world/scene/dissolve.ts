// The workshop materializing: the moment the particles have converged on its surfaces (the descent's
// counter at 100%, stations/descent/Generator.tsx), the real room plays in through a noise edge with a thin
// teal glow, from the floor up, in REVEAL_S of time (not over the scroll), then the lamps flicker on. One field drives both: a surface point shows once
// `reveal` passes the field there, and a particle sitting on it fades at that same moment, so the
// particles hand over to the surfaces exactly where they meet. Any built-in mesh material is patched
// once (dissolvable); the uniforms are shared, so one write per frame drives the whole room.
import { Color, type IUniform, type Material } from "three";

/** The field's range: [0, FIELD_MAX]. Below 0 nothing shows; past FIELD_MAX + the edge, everything. */
export const FIELD_MAX = 1;
/** The glowing band's width, in field units. */
export const DISSOLVE_EDGE = 0.014;
/** The descent's t at which the room is built (its counter reads 100%): the materialize plays then. */
export const BUILT_AT = 0.95;
/** The materialize's length (s): the whole room, at once. */
export const REVEAL_S = 1.1;
/** The longest step one frame may take (s): after a stall it plays on, it doesn't pop. */
export const MAX_STEP_S = 0.05;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Whether the room is built at the descent's t (the materialize plays, or has played). */
export const builtAt = (descentT: number) => descentT >= BUILT_AT;

/** The materialize's progress (0–1) a frame later: toward 1 while the room is built, back toward 0 if not. */
export function stepReveal(p: number, built: boolean, dt: number): number {
  const d = Math.min(dt, MAX_STEP_S) / REVEAL_S;
  return clamp01(built ? p + d : p - d);
}

/** `reveal` at the materialize's progress: nothing at 0, the whole room (and no edge) at 1. */
export function revealOf(p: number): number {
  return -0.03 + (FIELD_MAX + DISSOLVE_EDGE + 0.06) * smooth(0, 1, p);
}

/** The materialize's progress, shared: written by the workshop (stations/workshop/Scene.tsx), read by the lamps. */
export const materialize = { p: 0 };

/** The room stands whole: the lamps may start, the room may be used. */
export const roomWhole = () => materialize.p >= 1;

/** The shared uniforms: `reveal` is written once a frame (stations/workshop/Scene.tsx). */
export const dissolve = {
  reveal: { value: FIELD_MAX + 1 } as IUniform<number>,
  edge: { value: DISSOLVE_EDGE } as IUniform<number>,
  color: { value: new Color("#19f5c2").multiplyScalar(2.2) } as IUniform<Color>,
};

/** Whether the room shows at all (nothing is drawn while reveal is below the field's floor). */
export const anyRevealed = () => dissolve.reveal.value > 0;

/**
 * The field in GLSL, shared with the particles: three octaves of value noise over world space, plus a
 * rise with height, so the room builds from the floor up with a broken, organic edge.
 */
export const DISSOLVE_GLSL = /* glsl */ `
float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float dField(vec3 w) {
  float n = dNoise(w * 0.32) * 0.62 + dNoise(w * 1.1 + 7.1) * 0.28 + dNoise(w * 3.3 + 3.7) * 0.1;
  return n * 0.42 + clamp((w.y + 0.6) / 15.0, 0.0, 1.0) * 0.58;
}`;

interface ShaderLike {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, IUniform>;
}

/** Adds the field, the discard and the edge glow to a built-in mesh shader. False if it isn't one. */
export function injectDissolve(shader: ShaderLike): boolean {
  const v = shader.vertexShader;
  const f = shader.fragmentShader;
  const hooks = ["#include <common>", "#include <project_vertex>"].every((h) => v.includes(h));
  const fhooks = ["#include <common>", "#include <clipping_planes_fragment>", "#include <opaque_fragment>"].every((h) => f.includes(h));
  if (!hooks || !fhooks) return false;
  shader.uniforms.uReveal = dissolve.reveal;
  shader.uniforms.uDissolveEdge = dissolve.edge;
  shader.uniforms.uDissolveColor = dissolve.color;
  shader.vertexShader = v
    .replace("#include <common>", "#include <common>\nvarying vec3 vDissolveW;")
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
  vec4 dWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    dWorld = instanceMatrix * dWorld;
  #endif
  vDissolveW = (modelMatrix * dWorld).xyz;`,
    );
  shader.fragmentShader = f
    .replace("#include <common>", `#include <common>\nvarying vec3 vDissolveW;\nuniform float uReveal, uDissolveEdge;\nuniform vec3 uDissolveColor;\n${DISSOLVE_GLSL}`)
    .replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>
  float dN = dField(vDissolveW);
  if (dN > uReveal) discard;
  float dEdge = 1.0 - smoothstep(0.0, uDissolveEdge, uReveal - dN);`,
    )
    .replace("#include <opaque_fragment>", "outgoingLight += uDissolveColor * dEdge;\n  #include <opaque_fragment>");
  return true;
}

/** Makes a material materialize with the room. Idempotent; returns the material. */
export function dissolvable<M extends Material>(m: M): M {
  if (m.userData.dissolve) return m;
  m.userData.dissolve = true;
  const before = m.onBeforeCompile;
  const key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    before.call(m, shader, renderer);
    injectDissolve(shader);
  };
  m.customProgramCacheKey = () => `${key()}|dissolve`;
  m.needsUpdate = true;
  return m;
}

/** Built-in mesh materials, which have the hooks injectDissolve needs. */
export function canDissolve(m: Material): boolean {
  const k = m as Material & Record<string, unknown>;
  return !!(k.isMeshBasicMaterial || k.isMeshStandardMaterial || k.isMeshLambertMaterial || k.isMeshPhongMaterial);
}
