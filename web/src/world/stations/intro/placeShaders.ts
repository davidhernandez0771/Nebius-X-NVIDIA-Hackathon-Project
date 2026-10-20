// The forest's and the reactor's shaders. No textures and no lights: everything is shaded here, so a
// place costs one program per kind of surface and nothing to download. Each place has one set of
// uniforms (placeUniforms) shared by all its materials: `uLight` fades the whole place into the dark
// (storyPlan.ts placeLights), and its own fog and ground mist hide anything far off, so one place never
// shows through another. Colours are linear; the output goes through three's colour-space chunk, not
// its tone mapping, so a place faded to nothing is exactly the world's background.
import * as THREE from "three";
import { WORLD_BG } from "../../core/layout";
import { CRACK } from "./layout";
import { MIST_GLSL } from "./mistBands";

export interface PlaceFog {
  /** The fog's density (1 / metres). */
  k: number;
  /** Where the ground mist sits, and how fast it thins with height. */
  mistY: number;
  mistK: number;
  fog: string;
  mist: string;
}

/** One place's shared uniforms: write `uLight` (and the others) once and every material follows. */
export function placeUniforms(f: PlaceFog) {
  return {
    uLight: { value: 0 },
    uTime: { value: 0 },
    uBg: { value: new THREE.Color(WORLD_BG) },
    uFog: { value: new THREE.Color(f.fog) },
    uMist: { value: new THREE.Color(f.mist) },
    uFogK: { value: f.k },
    uMistY: { value: f.mistY },
    uMistK: { value: f.mistK },
    // Hanging mist bands (mistBands.ts), off unless a place sets their density.
    uBandY: { value: new THREE.Vector3() },
    uBandT: { value: new THREE.Vector3(1, 1, 1) },
    uBandK: { value: new THREE.Vector3() },
    uBandV: { value: new THREE.Vector3() },
  };
}
export type PlaceUniforms = ReturnType<typeof placeUniforms>;

export const NOISE_GLSL = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
float fbm2(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * vn2(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
float h31(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1., 0., 0.)), f.x), mix(h31(i + vec3(0., 1., 0.)), h31(i + vec3(1., 1., 0.)), f.x), f.y),
             mix(mix(h31(i + vec3(0., 0., 1.)), h31(i + vec3(1., 0., 1.)), f.x), mix(h31(i + vec3(0., 1., 1.)), h31(i + vec3(1., 1., 1.)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float s = 0., a = .5; for (int i = 0; i < 3; i++){ s += a * vn3(p); p = p * 2.07 + 11.3; a *= .5; } return s; }
`;

/** The place's light and fog over a lit colour at world point `wp`. */
export const PLACE_GLSL = /* glsl */ `
uniform float uLight, uTime, uFogK, uMistY, uMistK; uniform vec3 uBg, uFog, uMist;
${MIST_GLSL}
vec3 place(vec3 c, vec3 wp){
  float d = distance(wp, cameraPosition);
  float fog = 1. - exp(-d * uFogK);
  float mist = exp(-max(0., wp.y - uMistY) * uMistK) * (1. - exp(-d * uFogK * 1.8));
  c = mix(c, mix(uFog, uMist, clamp(mist, 0., 1.)), clamp(fog + mist * .55, 0., 1.));
  c = mistBands(c, wp);
  return mix(uBg, c, uLight);
}
`;

/** The crack's lens (forestPlan.ts crackHalfWidth), signed: below 0 inside it. */
export const CRACK_GLSL = /* glsl */ `
const vec2 CRACK_C = vec2(${CRACK.center[0].toFixed(4)}, ${CRACK.center[1].toFixed(4)});
const vec2 CRACK_DIR = vec2(${Math.cos(CRACK.angle).toFixed(6)}, ${(-Math.sin(CRACK.angle)).toFixed(6)});
const vec2 CRACK_ACROSS = vec2(${Math.sin(CRACK.angle).toFixed(6)}, ${Math.cos(CRACK.angle).toFixed(6)});
const float CRACK_L = ${CRACK.halfLength.toFixed(4)};
const float CRACK_W = ${CRACK.halfWidth.toFixed(4)};
float crackHW(float u){
  if (abs(u) >= CRACK_L) return 0.;
  float jag = 1. + .16 * sin(2.3 * u + 1.1) + .09 * sin(5.7 * u + .4);
  return CRACK_W * sqrt(1. - (u / CRACK_L) * (u / CRACK_L)) * jag;
}
float crackSD(vec2 xz){
  vec2 d = xz - CRACK_C;
  float u = dot(d, CRACK_DIR), v = dot(d, CRACK_ACROSS);
  if (abs(u) >= CRACK_L) return length(vec2(abs(u) - CRACK_L, v));
  return abs(v) - crackHW(u);
}
`;

/** World position and normal for a mesh (instanced or not). */
export const SURFACE_VERT = /* glsl */ `
varying vec3 vW; varying vec3 vN; varying vec2 vUv;
void main(){
  #ifdef USE_INSTANCING
    mat4 m = modelMatrix * instanceMatrix;
  #else
    mat4 m = modelMatrix;
  #endif
  vec4 w = m * vec4(position, 1.);
  vW = w.xyz;
  // The inverse transpose: the trunks are scaled 30 times taller than wide.
  vN = normalize(transpose(inverse(mat3(m))) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** A surface's fragment shader: the varyings, the noise, the crack and place(), then its own body. */
export const surfaceFrag = (frag: string) => `varying vec3 vW; varying vec3 vN; varying vec2 vUv;\n${NOISE_GLSL}\n${PLACE_GLSL}\n${CRACK_GLSL}\n${frag}`;

/** A ShaderMaterial for a place's surface. */
export function surfaceMaterial(u: PlaceUniforms, extra: Record<string, THREE.IUniform>, frag: string, opts: Partial<THREE.ShaderMaterialParameters> = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: SURFACE_VERT,
    fragmentShader: surfaceFrag(frag),
    uniforms: { ...u, ...extra },
    ...opts,
  });
}

/** Colour-space output, last in every fragment shader here. */
export const OUT = /* glsl */ `#include <colorspace_fragment>`;
