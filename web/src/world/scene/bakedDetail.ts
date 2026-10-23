// Detail on top of the baked room, in the shader, no new textures (high and ultra; low keeps the plain
// atlas). The bake holds the light; this adds what a 1-2 k atlas can't, by the surface's facing and
// height in world space:
// - the floor: polished concrete, mottled at two scales, with fine aggregate, and the pendant lamps
//   and the light over the spiral glinting in it as you move;
// - the walls: faint vertical brushing on the panels;
// - the table tops: a satin grain and a soft sheen from the lamp over each.
// The material stays a built-in MeshBasicMaterial, extended through onBeforeCompile with the hooks
// kept, so the materialize (dissolve.ts dissolvable, which wraps this) still works. The highlights
// scale with the material's colour, which the lamps drive (power.ts), so they go out with the room.
import * as THREE from "three";
import { SHAFTS } from "./Haze";

/** The lights that glint in the floor: the two pendants' bulbs and the light over the spiral (world). */
export const GLINTS: readonly THREE.Vector3[] = SHAFTS.map((s) => s.top.clone().setY(s.top.y + 0.04));

const vert = /* glsl */ `
varying vec3 vDetailW;
varying vec3 vDetailN;
`;

const frag = /* glsl */ `
varying vec3 vDetailW;
varying vec3 vDetailN;
uniform vec3 uGlints[${GLINTS.length}];
uniform vec3 uGlintColor;

float bkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bkNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bkHash(i), bkHash(i + vec2(1.0, 0.0)), u.x), mix(bkHash(i + vec2(0.0, 1.0)), bkHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/** GLSL for the detail factor and the glints, after the atlas is read (diffuseColor) and before the output. */
const surface = /* glsl */ `
  vec3 bkN = normalize(vDetailN);
  vec3 bkP = vDetailW;
  float bkFloor = step(0.9, bkN.y) * step(bkP.y, -0.15);
  float bkTop = step(0.9, bkN.y) * step(2.0, bkP.y) * step(bkP.y, 3.6);
  float bkWall = 1.0 - step(0.3, abs(bkN.y));
  float bkDetail = 1.0;
  // Concrete: broad clouds, smaller mottling, a fine aggregate.
  float bkMottle = bkNoise(bkP.xz * 0.35) * 0.6 + bkNoise(bkP.xz * 1.7) * 0.4;
  float bkGrit = bkHash(floor(bkP.xz * 70.0));
  bkDetail += bkFloor * ((bkMottle - 0.5) * 0.16 + (bkGrit - 0.5) * 0.05);
  // Wall panels: brushed top to bottom.
  float bkAlong = dot(bkP.xz, vec2(0.7071));
  bkDetail += bkWall * (bkNoise(vec2(bkAlong * 38.0, bkP.y * 0.8)) - 0.5) * 0.06;
  // Table tops: a fine satin grain.
  bkDetail += bkTop * (bkNoise(bkP.xz * vec2(60.0, 6.0)) - 0.5) * 0.05;
  diffuseColor.rgb *= bkDetail;
`;

const glint = /* glsl */ `
  {
    vec3 V = normalize(cameraPosition - vDetailW);
    vec3 R = reflect(-V, normalize(vDetailN));
    float gloss = bkFloor * 1.0 + bkTop * 0.45;
    if (gloss > 0.0) {
      vec3 g = vec3(0.0);
      for (int i = 0; i < ${GLINTS.length}; i++) {
        vec3 L = normalize(uGlints[i] - vDetailW);
        float c = max(dot(R, L), 0.0);
        // A tight glint and a broad sheen round it; the concrete's bkMottle breaks both up.
        g += uGlintColor * (pow(c, 220.0) * 0.55 + pow(c, 24.0) * 0.07);
      }
      outgoingLight += g * gloss * (0.75 + 0.5 * bkMottle) * diffuse;
    }
  }
`;

/** Add the detail to a baked room material (in place); returns it. */
export function withBakedDetail<M extends THREE.MeshBasicMaterial>(m: M): M {
  const uniforms = {
    uGlints: { value: GLINTS.map((v) => v.clone()) },
    uGlintColor: { value: new THREE.Color("#FFE3B8") },
  };
  const before = m.onBeforeCompile;
  const key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, renderer) => {
    before.call(m, sh, renderer);
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>${vert}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vDetailW = (modelMatrix * vec4(position, 1.0)).xyz;\n  vDetailN = normalize(mat3(modelMatrix) * normal);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>${frag}`)
      .replace("#include <map_fragment>", `#include <map_fragment>${surface}`)
      .replace("#include <opaque_fragment>", `${glint}  #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `${key()}|baked-detail`;
  m.needsUpdate = true;
  return m;
}
