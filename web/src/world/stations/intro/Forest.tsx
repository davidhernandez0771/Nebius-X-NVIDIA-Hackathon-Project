// The forest floor at night (forestPlan.ts lays it out, forestGeometry.ts builds it): dark trunks in three depths
// (near ones flaring into buttress roots, far ones silhouettes in the mist), roots spreading over the floor,
// fallen logs, ferns and moss mounds at the trunks' feet, three drifting bands of mist, shafts of moonlight
// through the canopy with pools under them, dust and glowing spores. Lying in the moss: the real robots
// (forestRobots.ts spots, their GLBs, two levels of detail by distance), mossy and faintly lit. In the
// floor is the crack (Crack.tsx: a Blender model can replace it). Fireflies in many colours drift over it all
// (fireflies.ts). All of it fades with the forest's light
// (storyPlan.ts); nothing is drawn while that is 0.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { QualityTier } from "../../core/quality";
import { makeCrack } from "./Crack";
import { makeRiftDetail } from "./riftDetail";
import { assets } from "../../core/assets";
import { buildForest, FOREST_TIERS, MOON, type ForestPiece } from "./forestGeometry";
import { crackFireflyCount, fireflies, fireflyCount } from "./fireflyPlan";
import { makeFireflies } from "./fireflies";
import { MIST_BANDS } from "./forestPlan";
import { ROBOT_TIERS, robotUrl } from "./forestRobots";
import type { Wrecks } from "./robotWrecks";
import { bandK } from "./mistBands";
import { FOREST } from "./layout";
import { seeded } from "./particles";
import { OUT, placeUniforms, surfaceFrag, surfaceMaterial, type PlaceUniforms } from "./placeShaders";

const F = FOREST.floor;
const BASE = (import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/");
const TEAL = new THREE.Color("#19f5c2");
const MAX_SHAFTS = 12;

export interface ForestState {
  light: number;
  /** The fall's light (storyPlan.ts dropLight): only the crack (and the fireflies falling into it) is drawn by it. */
  drop: number;
  /** Reduced motion: the fireflies hold still and only blink. */
  still?: boolean;
  /** The crack's glow comes up as the camera nears it (0–1). */
  glow: number;
  time: number;
  /** The renderer's pixel ratio, for the points' size. */
  pr: number;
}

const groundFrag = /* glsl */ `
uniform vec4 uShafts[${MAX_SHAFTS}]; uniform float uGlow; uniform vec3 uTeal;
void main(){
  float sd = crackSD(vW.xz);
  if (sd < 0.) discard;
  vec2 p = vW.xz;
  float n = fbm2(p * .35);
  float moss = smoothstep(.42, .68, fbm2(p * .17 + 3.1));
  // Linear colours: near black soil, mossy patches a shade greener, leaf litter, fine grain.
  vec3 c = mix(vec3(.0062, .0058, .0052), vec3(.0068, .0118, .0092), moss) * (.55 + .9 * n) * (.8 + .4 * vn2(p * 5.));
  c += vec3(.004, .0032, .002) * smoothstep(.72, .9, vn2(p * 2.3 + 7.)) * (1. - moss);
  float pool = 0.;
  for (int i = 0; i < ${MAX_SHAFTS}; i++){ vec4 s = uShafts[i]; vec2 d = p - s.xy; pool += s.w * exp(-dot(d, d) / (s.z * s.z)); }
  c += vec3(.045, .058, .068) * pool * (.7 + .6 * n);
  // The lip: darker, then a thin cold glow from far below.
  c *= 1. - .8 * (1. - smoothstep(0., .9, sd));
  c += uTeal * uGlow * .03 * (1. - smoothstep(0., .6, sd));
  // Its edge caught by that light, broken where the rock has crumbled; hairline fractures running off it into the
  // ground, lit from inside, fading with distance from the lip.
  float broken = smoothstep(.35, .6, vn2(p * 5.));
  c += uTeal * uGlow * .1 * (1. - smoothstep(0., .07, sd)) * broken;
  float vein = 1. - smoothstep(0., .05, abs(vn2(p * 1.6 + 4.2) - .5) + .02 * vn2(p * 9.));
  c += uTeal * uGlow * .035 * vein * (1. - smoothstep(.05, 2.6, sd)) * smoothstep(.3, .7, vn2(p * .9 + 1.3));
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

// The bark: deep furrows running up the trunk between raised plates, the plates cracked across, a knot now and
// then, all as relief (a bump from the height field, fading with distance so far trunks don't shimmer); each trunk its
// own shade (aTint) and grain; pale lichen on the plates, more on the moon's side; moss climbing the foot; a cold
// edge where the moon catches it; up into the dark above.
const BARK = /* glsl */ `
uniform vec3 uMoon; uniform float uFloor, uCanopy;
float barkH(float around, float tint){
  float freq = floor(7. + 5. * tint);
  float ridge = abs(sin(around * 6.2832 * freq + fbm2(vec2(around * 9., vW.y * .35)) * 5.));
  float plate = smoothstep(.12, .6, ridge);
  float cracks = smoothstep(.72, .92, vn2(vec2(around * freq * 2.3, vW.y * 1.7 + tint * 9.)));
  float knot = smoothstep(.84, .97, vn2(vec2(around * 4. + tint * 3., vW.y * .22)));
  return plate * (1. - .5 * cracks) + .45 * knot;
}
vec3 bumped(vec3 n, float h, float k){
  vec3 dpdx = dFdx(vW), dpdy = dFdy(vW);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 g = sign(det) * (dFdx(h) * k * r1 + dFdy(h) * k * r2);
  return normalize(abs(det) * n - g);
}
vec3 bark(vec3 n0, float around, float tint){
  float h = barkH(around, tint);
  vec3 n = bumped(n0, h, .07 * (1. - smoothstep(8., 30., distance(cameraPosition, vW))));
  float grain = fbm2(vec2(around * 26. + tint * 17., vW.y * .55));
  vec3 c = mix(vec3(.0042, .004, .0038), vec3(.0064, .005, .0038), tint) * (.5 + .7 * grain) * (.35 + .95 * h);
  c += vec3(.014, .019, .024) * max(0., dot(n, uMoon)) * (.45 + .55 * h);
  vec3 v = normalize(cameraPosition - vW);
  c += vec3(.012, .017, .022) * pow(1. - max(0., dot(n, v)), 3.);
  float lichen = smoothstep(.6, .74, fbm2(vec2(around * 14. + tint * 5., vW.y * 1.1))) * smoothstep(.35, .75, h)
               * (.35 + .65 * smoothstep(0., .6, dot(n0, uMoon))) * step(uFloor + 1.2, vW.y);
  c = mix(c, vec3(.015, .018, .02) * (.7 + .5 * grain), lichen * .65);
  float mossy = (1. - smoothstep(uFloor, uFloor + 2.2 + 1.5 * tint, vW.y)) * .75
              + smoothstep(.3, .9, dot(n0, uMoon)) * smoothstep(.45, .7, fbm2(vec2(around * 5., vW.y * .25))) * .5;
  c = mix(c, vec3(.0052, .0098, .0074) * (.6 + .8 * grain) * (.6 + .5 * h), clamp(mossy, 0., 1.));
  return mix(c, uFog, smoothstep(uFloor + uCanopy * .35, uFloor + uCanopy * .95, vW.y));
}
`;

// Each trunk its own shape (from its tint): it wanders off its line as it rises (the foot stays put; forestGeometry.ts
// trunkBend mirrors this, so the branch cards stay on it), its section fluted and uneven all the way up, its taper
// its own.
const trunkVert = /* glsl */ `
attribute float aTint;
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying float vTint;
void main(){
  vec3 p = position;
  float y = clamp(p.y, 0., 1.);
  float s = aTint * 61.7;
  float a = atan(position.z, position.x);
  p.xz *= (1. + .07 * sin(3. * a + s * 5. + y * 3.) + .04 * sin(7. * a + s * 2.)) * (1. - .28 * y * fract(s * 3.1));
  p.xz += vec2(sin(y * 2.3 + s), cos(y * 1.9 + s * 1.3)) * 1.8 * y * y;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(p, 1.);
  vW = w.xyz;
  vN = normalize(transpose(inverse(mat3(m))) * normal);
  vUv = uv;
  vTint = aTint;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const trunkFrag = /* glsl */ `
varying float vTint;
${BARK}
void main(){
  gl_FragColor = vec4(place(bark(normalize(vN), vUv.x, vTint), vW), 1.);
  ${OUT}
}`;

const rootFrag = /* glsl */ `
${BARK}
void main(){
  // uv.y runs round the root: its bark ridges run along it.
  vec3 c = bark(normalize(vN), vUv.y + vUv.x * .3, .4);
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

const logFrag = /* glsl */ `
${BARK}
void main(){
  vec3 n = normalize(vN);
  vec3 c = bark(n, vUv.y + vUv.x * .2, .7);
  // Moss over the top of a fallen log, deeper where it has lain longest.
  float top = smoothstep(.2, .8, n.y) * smoothstep(.35, .6, fbm2(vW.xz * 1.3));
  c = mix(c, vec3(.0058, .0115, .0085) * (.7 + .6 * fbm2(vW.xz * 6.)), top);
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

const fernFrag = /* glsl */ `
uniform vec3 uMoon;
void main(){
  // Leaflets along the frond: cut out of the strip, narrowing toward the tip.
  float along = vUv.x, across = abs(vUv.y - .5) * 2.;
  float leaflet = .55 + .45 * abs(sin(along * 46.));
  if (across > leaflet * (1. - along * .75) || along > .98) discard;
  float vein = smoothstep(.06, 0., across);
  vec3 c = mix(vec3(.0035, .0085, .0062), vec3(.006, .014, .01), along) * (.7 + .5 * fbm2(vW.xz * 3.));
  c += vec3(.008, .012, .014) * max(0., dot(normalize(vN), uMoon)) + vec3(.002, .004, .003) * vein;
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

// The canopy's branch cards (forestGeometry.ts canopyMatrices): uv.x runs out along the branch, uv.y up the card. A
// rising limb thinning to its tip, twigs off it, clumps of leaves round them, cut out of the card (alpha-tested, so
// no sorting): dark shapes against the fog high above, the far ones dissolving into it.
const canopyFrag = /* glsl */ `
uniform vec3 uMoon;
float seg(vec2 p, vec2 a, vec2 b, float r){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h) - r; }
void main(){
  vec2 uv = vUv;
  float wob = .05 * sin(uv.x * 6. + vW.y * .7 + vW.x);
  float limbY = .1 + .5 * pow(uv.x, 1.35) + wob;
  float d = abs(uv.y - limbY) - (.05 * (1. - uv.x) + .007);
  for (int k = 1; k < 7; k++){
    float u0 = float(k) / 7.;
    vec2 a = vec2(u0, .1 + .5 * pow(u0, 1.35) + .05 * sin(u0 * 6. + vW.y * .7 + vW.x));
    float side = mod(float(k), 2.) < .5 ? 1. : -.7;
    d = min(d, seg(uv, a, a + vec2(.1 + .06 * u0, side * .25 * (1.15 - u0)), .004 + .012 * (1. - u0)));
  }
  // Leaf clumps: noise round the twigs, thicker toward the branch's end.
  float clump = fbm2(uv * vec2(10., 7.) + vW.xz * .21) + .38 * smoothstep(.15, .9, uv.x) - .32 * smoothstep(0., .14, d) - .7;
  if (min(d, -clump * .3) > 0. || uv.y > .97 || uv.y < .02) discard;
  vec3 n = normalize(vN);
  vec3 c = vec3(.0032, .004, .0038) + vec3(.004, .006, .008) * abs(dot(n, uMoon));
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

// The backdrop ring (forestGeometry.ts BACKDROP_R): rows of trunks deeper in the fog than the forest's last ones,
// each row fainter, rising into the dark: the forest goes on. Its own fog (place() would wash it out entirely).
const backdropFrag = /* glsl */ `
void main(){
  float u = vUv.x, y = vUv.y;
  vec3 c = uFog;
  for (int k = 2; k >= 0; k--){
    float fk = float(k);
    float n = 60. + 45. * fk;
    float cell = floor(u * n);
    float r = h21(vec2(cell, fk * 7.1 + 3.));
    float x = fract(u * n) - .5 - (r - .5) * .5;
    float w = (.1 + .16 * fract(r * 13.7)) * (1. - .35 * y) + .03 * vn2(vec2(cell, y * 6.));
    float trunk = (1. - smoothstep(w - .02, w + .02, abs(x))) * step(.35, fract(r * 5.3));
    float row = mix(.42, .14, fk / 2.);
    c = mix(c, uFog * (1. - row), trunk * (1. - smoothstep(.45, .95, y)));
  }
  // The canopy over them: a ragged dark band high up, fading into the night.
  float crown = smoothstep(.55, .75, y + .12 * fbm2(vec2(u * 40., y * 3.)));
  c = mix(c, mix(uFog, uBg, .5), crown * .6);
  c = mistBands(c, vW);
  gl_FragColor = vec4(mix(uBg, c, uLight), 1.);
  ${OUT}
}`;

const mossFrag = /* glsl */ `
uniform vec3 uMoon;
void main(){
  vec3 n = normalize(vN);
  float fuzz = fbm3(vW * 9.);
  vec3 c = vec3(.0055, .011, .008) * (.55 + .9 * fuzz);
  c += vec3(.006, .01, .011) * max(0., dot(n, uMoon)) * (.6 + .4 * fuzz);
  vec3 v = normalize(cameraPosition - vW);
  c += vec3(.004, .009, .008) * pow(1. - max(0., dot(n, v)), 2.);
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

// The robots (robotWrecks.ts): the surface varyings and each part's paint. The levels of detail switch outright
// (robotLod.ts): the old per-pixel dissolve between them read as speckle up close.
const robotVert = /* glsl */ `
attribute vec3 color;
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vCol;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  vCol = color;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const partFrag = /* glsl */ `
uniform vec3 uMoon, uTeal; uniform float uFloor;
varying vec3 vCol;
void main(){
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1. : -1.);
  vec3 v = normalize(cameraPosition - vW);
  float grime = fbm3(vW * 2.2);
  // The robot's own paint (white shells, dark joints), dulled by the years in the forest and dirty: pale shapes in the
  // dark. Black parts stay a dark grey, so a black robot still reads as a shape.
  vec3 paint = mix(vec3(dot(vCol, vec3(.2126, .7152, .0722))), vCol, .55);
  vec3 shell = max(paint, vec3(.3)) * vec3(.4, .42, .39) * (.6 + .5 * grime);
  // The moon, plus a little night sky from above and the moss's bounce from below, so the side away from the moon
  // keeps its form instead of going flat black.
  float sky = .5 + .5 * n.y;
  vec3 c = shell * (.025 + .3 * max(0., dot(n, uMoon)) + mix(vec3(.012, .016, .014), vec3(.03, .038, .046), sky));
  vec3 h = normalize(uMoon + v);
  c += vec3(.16, .19, .21) * pow(max(0., dot(n, h)), 30.) * (.5 + .5 * grime);
  float rim = pow(1. - max(0., dot(n, v)), 3.);
  c += mix(vec3(.035, .045, .05), uTeal * .08, .4) * rim;
  // Moss creeping up from where it's buried (higher in patches), and over the top where it has lain.
  float mossy = 1. - smoothstep(uFloor - .05, uFloor + .3 + .45 * fbm2(vW.xz * 3.), vW.y);
  mossy = max(mossy, smoothstep(.55, .95, n.y) * smoothstep(.5, .72, fbm2(vW.xz * 4.)) * .85);
  c = mix(c, vec3(.005, .009, .007) * (.6 + .7 * grime), mossy);
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

/** The forest's night: the fog's colour low down, the world's dark overhead. */
const skyFrag = /* glsl */ `
uniform vec3 uCenter;
void main(){
  vec3 d = normalize(vW - uCenter);
  vec3 c = mix(uFog, uBg, smoothstep(-.05, .55, d.y));
  gl_FragColor = vec4(mix(uBg, c, uLight), 1.);
  ${OUT}
}`;

const shaftVert = /* glsl */ `
varying vec2 vUv; varying vec3 vW;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const shaftFrag = /* glsl */ `
varying vec2 vUv; varying vec3 vW;
uniform float uLight, uTime, uFogK;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
void main(){
  float edge = smoothstep(0., .4, vUv.x) * smoothstep(1., .6, vUv.x);
  // Brightest a little above the floor, fading up into the canopy's dark.
  float fall = smoothstep(0., .05, vUv.y) * pow(1. - vUv.y, 1.4);
  float flick = .7 + .3 * vn2(vec2(vUv.x * 3. + uTime * .05, vUv.y * 2. - uTime * .03));
  float streak = .75 + .25 * vn2(vec2(vUv.x * 11., vUv.y * .7));
  float d = distance(vW, cameraPosition);
  float a = edge * fall * flick * streak * smoothstep(1.5, 7., d) * exp(-d * uFogK * .7) * .08 * uLight;
  gl_FragColor = vec4(vec3(.42, .52, .6), a);
  ${OUT}
}`;

const moteVert = /* glsl */ `
attribute vec4 aRand; uniform float uTime, uPR, uSize, uRise;
varying float vA;
void main(){
  vec3 p = position;
  p.y = ${F.toFixed(1)} + mod(p.y - ${F.toFixed(1)} + uTime * (uRise + aRand.x * uRise * 2.), 12.);
  p.x += sin(uTime * .2 + aRand.y * 20.) * .5; p.z += cos(uTime * .16 + aRand.z * 20.) * .5;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize * uPR * (.4 + aRand.w) * (20. / max(.5, -mv.z)), 3.5 * uPR);
  vA = (.15 + .35 * aRand.y) * exp(-(-mv.z) * .05) * (.6 + .4 * sin(uTime * (.7 + aRand.z) + aRand.w * 40.));
}`;

const moteFrag = /* glsl */ `
varying float vA; uniform float uLight; uniform vec3 uColor;
void main(){ vec2 c = gl_PointCoord - .5; float r = dot(c, c) * 4.; if (r > 1.) discard;
  gl_FragColor = vec4(uColor, (1. - r) * (1. - r) * vA * uLight);
  ${OUT}
}`;

/** Motes (dust or spores): seeded positions, rising and swaying in the shader. */
function motes(positions: readonly (readonly number[])[], u: PlaceUniforms, pr: { value: number }, opts: { size: number; rise: number; color: string }) {
  const rnd = seeded(91 + positions.length);
  const pos = new Float32Array(positions.length * 3);
  const rand = new Float32Array(positions.length * 4);
  positions.forEach((p, i) => {
    pos.set(p, i * 3);
    rand.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));
  const m = new THREE.ShaderMaterial({
    vertexShader: moteVert,
    fragmentShader: moteFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uLight: u.uLight, uTime: u.uTime, uPR: pr, uSize: { value: opts.size }, uRise: { value: opts.rise }, uColor: { value: new THREE.Color(opts.color) } },
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

const MESH_PIECE: Record<string, (u: PlaceUniforms) => THREE.Material> = {
  roots: (u) => surfaceMaterial(u, { uMoon: { value: MOON }, uFloor: { value: F }, uCanopy: { value: FOREST.canopy } }, rootFrag),
  logs: (u) => surfaceMaterial(u, { uMoon: { value: MOON }, uFloor: { value: F }, uCanopy: { value: FOREST.canopy } }, logFrag),
  ferns: (u) => surfaceMaterial(u, { uMoon: { value: MOON } }, fernFrag, { side: THREE.DoubleSide }),
  moss: (u) => surfaceMaterial(u, { uMoon: { value: MOON } }, mossFrag),
  canopy: (u) => surfaceMaterial(u, { uMoon: { value: MOON } }, canopyFrag, { side: THREE.DoubleSide }),
  backdrop: (u) => surfaceMaterial(u, {}, backdropFrag, { side: THREE.BackSide, depthWrite: false }),
};

function pieceObject(p: ForestPiece, u: PlaceUniforms): { object: THREE.Object3D; material: THREE.Material } {
  if (p.name.startsWith("trunks:")) {
    const material = new THREE.ShaderMaterial({
      vertexShader: trunkVert,
      fragmentShader: surfaceFrag(trunkFrag),
      uniforms: { ...u, uMoon: { value: MOON }, uFloor: { value: F }, uCanopy: { value: FOREST.canopy } },
    });
    p.geometry.setAttribute("aTint", new THREE.InstancedBufferAttribute(p.attributes!.aTint, 1));
    const mesh = new THREE.InstancedMesh(p.geometry, material, p.instances!);
    p.matrices!.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.frustumCulled = false;
    return { object: mesh, material };
  }
  if (p.name === "shafts") {
    const material = new THREE.ShaderMaterial({
      vertexShader: shaftVert,
      fragmentShader: shaftFrag,
      uniforms: { uLight: u.uLight, uTime: u.uTime, uFogK: u.uFogK },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(p.geometry, material);
    mesh.renderOrder = 2;
    return { object: mesh, material };
  }
  const material = MESH_PIECE[p.name](u);
  if (p.instances) {
    const mesh = new THREE.InstancedMesh(p.geometry, material, p.instances);
    p.matrices!.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.frustumCulled = false;
    return { object: mesh, material };
  }
  return { object: new THREE.Mesh(p.geometry, material), material };
}

export interface ForestHandle {
  group: THREE.Group;
  update(s: ForestState): void;
  dispose(): void;
}

export function useForest(quality: QualityTier): ForestHandle {
  const tier = quality.name;
  const handle = useMemo<ForestHandle>(() => {
    const { pieces, layout } = buildForest(tier);
    const u = placeUniforms({ k: 0.045, mistY: F + 0.3, mistK: 0.5, fog: "#141b20", mist: "#25313a" });
    // The hanging mist bands, drawn by every surface (mistBands.ts); the low tier keeps the lower two.
    const bands = MIST_BANDS.slice(0, FOREST_TIERS[tier].mistBands);
    MIST_BANDS.forEach((b, i) => {
      u.uBandY.value.setComponent(i, F + b.y);
      u.uBandT.value.setComponent(i, b.thickness);
      u.uBandK.value.setComponent(i, i < bands.length ? bandK(b.opacity) : 0);
      u.uBandV.value.setComponent(i, b.speed);
    });
    const pr = { value: 1 };
    const glow = { value: 0 };
    const group = new THREE.Group();
    group.name = "intro:forest";
    const disposables: { dispose(): void }[] = [];
    const add = <T extends THREE.Object3D>(o: T, name: string) => {
      o.raycast = () => {};
      o.name = name;
      group.add(o);
      return o;
    };

    const skyGeo = new THREE.SphereGeometry(110, 32, 16).translate(FOREST.center[0], F, FOREST.center[1]);
    const skyMat = surfaceMaterial(u, { uCenter: { value: new THREE.Vector3(FOREST.center[0], F, FOREST.center[1]) } }, skyFrag, { side: THREE.BackSide, depthWrite: false });
    const sky = add(new THREE.Mesh(skyGeo, skyMat), "forest:sky");
    sky.renderOrder = -5;
    sky.frustumCulled = false;

    const shaftU = Array.from({ length: MAX_SHAFTS }, (_, i) => {
      const s = layout.shafts[i];
      return s ? new THREE.Vector4(s.x, s.z, s.radius * 1.6, 1) : new THREE.Vector4(0, 0, 1, 0);
    });
    const groundGeo = new THREE.CircleGeometry(FOREST.radius + 30, tier === "low" ? 48 : 96).rotateX(-Math.PI / 2).translate(FOREST.center[0], F, FOREST.center[1]);
    const groundMat = surfaceMaterial(u, { uShafts: { value: shaftU }, uGlow: glow, uTeal: { value: TEAL } }, groundFrag);
    add(new THREE.Mesh(groundGeo, groundMat), "forest:floor");
    disposables.push(skyGeo, skyMat, groundGeo, groundMat);

    for (const p of pieces) {
      const { object, material } = pieceObject(p, u);
      add(object, `forest:${p.name}`);
      disposables.push(p.geometry, material);
      if ((object as THREE.InstancedMesh).isInstancedMesh) disposables.push(object as THREE.InstancedMesh);
    }

    // The low tier keeps the procedural crack (Crack.tsx: the model is ~27k triangles).
    const crack = makeCrack(u, glow, (url) => assets.fetch(url), tier !== "low");
    group.add(crack.group);
    // The rift's lip from the forest: stones, embers and its rising light (riftDetail.ts); not in the fall.
    const rift = makeRiftDetail(u, glow, tier);
    add(rift.group, "forest:rift");
    disposables.push(rift);

    // Dust drifting everywhere along the walk; spores, fewer and brighter, rising slowly.
    const dustRnd = seeded(91);
    const ground = layout.spores;
    const dustPos = Array.from({ length: tier === "low" ? 600 : 2000 }, (_, i) => {
      const [x, , z] = ground[i % ground.length];
      return [x + (dustRnd() - 0.5) * 8, F + dustRnd() * 12, z + (dustRnd() - 0.5) * 8];
    });
    const dust = add(motes(dustPos, u, pr, { size: 1.4, rise: 0.05, color: "#b3ccd9" }), "forest:dust");
    const sporesPts = add(motes(layout.spores, u, pr, { size: 2.6, rise: 0.03, color: "#7ff0d4" }), "forest:spores");
    disposables.push(dust.geometry, dust.material as THREE.Material, sporesPts.geometry, sporesPts.material as THREE.Material);

    // Fireflies in many colours (fireflyPlan.ts): one Points draw, all motion in the shader; fewer on phones.
    const phone = typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 600px)").matches;
    // The crack's (they fall with the camera) keep the fall's old count, on top of the forest's own.
    const crackFlies = crackFireflyCount(tier, phone);
    const flies = makeFireflies(fireflies(fireflyCount(tier, phone) + crackFlies, layout, ROBOT_TIERS[tier].ids, crackFlies));
    add(flies.points, "forest:fireflies");
    // The lantern fireflies light every forest surface round them (placeShaders.ts place()).
    u.uGlowP.value = flies.glows.position;
    u.uGlowC.value = flies.glows.color;
    disposables.push(flies);

    // The robots: empty until their GLBs have loaded (after the loader; the low tier fetches four). Each frame the
    // index list holds every robot's coarse level and, near the camera, its detailed one (robotWrecks.ts).
    const robotTier = ROBOT_TIERS[tier];
    const partMat = new THREE.ShaderMaterial({
      vertexShader: robotVert,
      fragmentShader: surfaceFrag(partFrag),
      uniforms: { ...u, uMoon: { value: MOON }, uTeal: { value: TEAL }, uFloor: { value: F } },
      side: THREE.DoubleSide,
    });
    const wrecks = add(new THREE.Mesh<THREE.BufferGeometry>(new THREE.BoxGeometry(0.01, 0.01, 0.01).translate(0, F - 1, 0), partMat), "forest:robots");
    const eye = new THREE.Vector3();
    const view = new THREE.Frustum();
    const vp = new THREE.Matrix4();
    let robots: Wrecks | null = null;
    // Only the robots in view are drawn (each at its level by distance).
    wrecks.onBeforeRender = (_r, _s, camera) =>
      robots?.update(eye.setFromMatrixPosition(camera.matrixWorld), view.setFromProjectionMatrix(vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)));
    let live = true;
    let maker: { dispose(): void } | null = null;
    Promise.all([import("./robotWrecks"), import("./robotLevelsClient")])
      .then(async ([w, c]) => {
        const loader = new GLTFLoader();
        const lm = c.levelMaker();
        maker = lm;
        // Each model's levels are simplified in a worker as it arrives (robotLevelsClient.ts), off the main thread.
        const loaded = await Promise.all(robotTier.ids.map((id) =>
          loader.loadAsync(BASE + robotUrl(id)).then(async (g) => {
            const model = w.modelFromScene(g.scene);
            return [id, model, await lm.make(id, model, robotTier)] as const;
          }, (e) => {
            console.warn(`world: the forest's ${id} didn't load`, e);
            return null;
          })));
        lm.dispose();
        if (!live) return;
        const ok = loaded.filter((x) => x !== null);
        robots = w.buildWrecks(Object.fromEntries(ok.map(([id, m]) => [id, m])), layout.robots, robotTier, F, Object.fromEntries(ok.map(([id, , l]) => [id, l])));
        wrecks.geometry.dispose();
        wrecks.geometry = robots.geometry;
      })
      .catch((e) => console.warn("world: the forest's robots didn't load", e));
    disposables.push(partMat);

    return {
      group,
      update(s) {
        u.uLight.value = s.light;
        u.uTime.value = s.time;
        glow.value = s.glow;
        pr.value = s.pr;
        crack.update(s.drop);
        rift.update(s.time, s.pr);
        // The crack's fireflies swirl into it over the last stretch of the walk toward it (s.glow comes up then).
        const near = Math.min(1, Math.max(0, (s.glow - 0.25) / 0.75));
        flies.update({ time: s.time, light: s.light, drop: s.drop, swirl: near * near * (3 - 2 * near), pr: s.pr, still: !!s.still });
        // Through the fall the forest is out: only the crack's walls and the fireflies falling with the camera.
        group.visible = s.light > 0 || s.drop > 0;
        for (const c of group.children) c.visible = c === crack.group || c === flies.points || s.light > 0;
      },
      dispose() {
        live = false;
        maker?.dispose();
        wrecks.geometry.dispose();
        crack.dispose();
        disposables.forEach((d) => d.dispose());
      },
    };
  }, [tier]);
  useEffect(() => () => handle.dispose(), [handle]);
  return handle;
}
