// The rift's detail, seen from the forest: loose stones on its lip, embers drifting up out of the depths, and a soft
// curtain of the reactor's light rising off its outline (the lip's glowing edge and the fractures running off it are the
// forest floor's own shader, Forest.tsx). All of it shows only while the forest is lit, so the fall down the crack
// and its hand-over to the reactor (Crack.tsx, storyPlan.ts dropLight) are exactly as they were.
// The stones' places are pure and seeded, so the tests hold them; the embers and the glow move in their shaders.
import * as THREE from "three";
import type { TierName } from "../../core/quality";
import { crackHalfWidth } from "./forestPlan";
import { CRACK, FOREST } from "./layout";
import { seeded } from "./particles";
import { OUT, surfaceMaterial, type PlaceUniforms } from "./placeShaders";

const F = FOREST.floor;
const TEAL = new THREE.Color("#19f5c2");

/** Stones on the lip per tier (the low tier has no triangles to spare), and the embers rising out of it. */
export const RIFT_STONES: Record<TierName, number> = { low: 0, high: 120, ultra: 120 };
export const RIFT_EMBERS: Record<TierName, number> = { low: 60, high: 160, ultra: 220 };
/** A stone is an octahedron, squashed into a chip. */
export const STONE_TRIS = 8;
/** The glow: a curtain round the lens outline, this many sides. */
export const GLOW_SIDES = 48;
export const GLOW_TRIS = GLOW_SIDES * 2;

/** The rift's triangles drawn from the forest (the stones and the glow), for the forest's budget. */
export const riftTriangles = (tier: TierName) => RIFT_STONES[tier] * STONE_TRIS + GLOW_TRIS;

/** A point in the crack's frame (u along it, v across it) on the floor, in world x, z. */
export function crackPoint(u: number, v: number): [number, number] {
  const c = Math.cos(CRACK.angle), s = -Math.sin(CRACK.angle);
  return [CRACK.center[0] + u * c + v * Math.sin(CRACK.angle), CRACK.center[1] + u * s + v * Math.cos(CRACK.angle)];
}

export interface Stone {
  x: number;
  z: number;
  /** Its half size (m). */
  size: number;
  /** How far beyond the crack's edge it lies (m). */
  out: number;
  yaw: number;
  tilt: number;
}

/** n stones scattered along the lip, thickest at the edge, bigger close to it (broken off it). */
export function riftStones(n: number): Stone[] {
  const rnd = seeded(7331);
  const L = CRACK.halfLength;
  const out: Stone[] = [];
  for (let i = 0; i < n; i++) {
    const u = (rnd() * 2 - 1) * L * 0.95;
    const side = rnd() < 0.5 ? -1 : 1;
    const off = 0.06 + rnd() ** 2.2 * 1.8;
    const [x, z] = crackPoint(u, side * (crackHalfWidth(u) + off));
    out.push({ x, z, size: (0.05 + 0.26 * rnd() ** 1.5) * (1.2 - off / 2.2), out: off, yaw: rnd() * Math.PI * 2, tilt: (rnd() - 0.5) * 0.9 });
  }
  return out;
}

const stoneFrag = /* glsl */ `
uniform vec3 uTeal; uniform float uGlow;
void main(){
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1. : -1.);
  float g = fbm3(vW * 7.);
  vec3 c = vec3(.006, .0058, .0055) * (.5 + g) + vec3(.008, .01, .012) * max(0., n.y) * .6;
  // Lit from the rift beside it: the faces turned toward the crack catch its cold light.
  float edge = 1. - smoothstep(0., 1.8, crackSD(vW.xz));
  c += uTeal * uGlow * .05 * edge * edge * (.4 + .6 * clamp(-n.y + .5, 0., 1.));
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

const glowVert = /* glsl */ `
varying vec2 vUv; varying vec3 vW; varying vec3 vN;
void main(){ vUv = uv; vN = normal; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

// The light rising out of the rift: brightest at the lip, thinning up into the dark, slowly shifting; strongest where
// the curtain is seen edge-on (more of it along the line of sight), as haze is.
const glowFrag = /* glsl */ `
varying vec2 vUv; varying vec3 vW; varying vec3 vN;
uniform float uLight, uGlow, uTime; uniform vec3 uTeal;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
void main(){
  float rise = exp(-vUv.y * 3.) * smoothstep(0., .05, vUv.y);
  float drift = .55 + .45 * vn2(vec2(vUv.x * 18., vUv.y * 2.5 - uTime * .3));
  float grazing = 1. - abs(dot(normalize(vN), normalize(cameraPosition - vW)));
  float a = rise * drift * (.25 + .75 * grazing * grazing) * uGlow * uLight * .045;
  gl_FragColor = vec4(uTeal * a, 1.);
  ${OUT}
}`;

// Embers: specks of the reactor's light drifting up out of the rift, swaying, fading as they climb.
const emberVert = /* glsl */ `
attribute vec4 aRand;
uniform float uTime, uPR, uLight, uGlow;
varying float vA;
void main(){
  float life = 5.5;
  float k = fract(uTime / (life * (.7 + .6 * aRand.x)) + aRand.y);
  vec3 p = position + vec3(sin(uTime * (.6 + aRand.z) + aRand.w * 20.) * .25 * k, -1.2 + k * 5.5, cos(uTime * (.5 + aRand.x) + aRand.z * 20.) * .25 * k);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((1.5 + 2.5 * aRand.w) * uPR * (8. / max(.5, -mv.z)), uPR, 5. * uPR);
  vA = smoothstep(0., .15, k) * (1. - smoothstep(.45, 1., k)) * uLight * uGlow * (.5 + .5 * sin(uTime * 3. + aRand.y * 30.));
}`;

const emberFrag = /* glsl */ `
varying float vA; uniform vec3 uTeal;
void main(){
  vec2 c = gl_PointCoord - .5; float r = dot(c, c) * 4.;
  if (r > 1.) discard;
  gl_FragColor = vec4(mix(uTeal, vec3(1.), .35) * (1. - r) * vA, 1.);
  ${OUT}
}`;

export interface RiftDetail {
  group: THREE.Group;
  update(time: number, pr: number): void;
  dispose(): void;
}

/** The rift's stones, embers and glow for a tier, in the forest's light (u) and the crack's glow. */
export function makeRiftDetail(u: PlaceUniforms, glow: THREE.IUniform<number>, tier: TierName): RiftDetail {
  const group = new THREE.Group();
  group.name = "forest:rift";
  const disposables: { dispose(): void }[] = [];
  const time = { value: 0 };
  const pr = { value: 1 };

  const stones = riftStones(RIFT_STONES[tier]);
  if (stones.length) {
    const geo = new THREE.OctahedronGeometry(1, 0);
    const mat = surfaceMaterial(u, { uTeal: { value: TEAL }, uGlow: glow }, stoneFrag);
    const mesh = new THREE.InstancedMesh(geo, mat, stones.length);
    const q = new THREE.Quaternion();
    stones.forEach((s, i) =>
      mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, F - s.size * 0.25, s.z), q.setFromEuler(new THREE.Euler(s.tilt, s.yaw, s.tilt * 0.5)).clone(),
        new THREE.Vector3(s.size * 1.3, s.size * 0.55, s.size))));
    mesh.frustumCulled = false;
    mesh.name = "rift:stones";
    group.add(mesh);
    disposables.push(geo, mat, mesh);
  }

  // The glow: a curtain standing on the lens outline (uv.x round it, uv.y up it), normals out from the crack.
  const L = CRACK.halfLength;
  const H = 4;
  const ring: [number, number][] = [];
  for (let i = 0; i < GLOW_SIDES; i++) {
    const t = (i / GLOW_SIDES) * Math.PI * 2;
    const uu = Math.cos(t) * L * 0.98;
    ring.push([uu, Math.sign(Math.sin(t)) * crackHalfWidth(uu) * 0.92]);
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  ring.forEach(([uu, vv], i) => {
    const [x, z] = crackPoint(uu, vv);
    const [nx, nz] = [x - CRACK.center[0], z - CRACK.center[1]];
    const nl = Math.hypot(nx, nz) || 1;
    for (const t of [0, 1]) {
      pos.push(x, F - 0.3 + t * H, z);
      nor.push(nx / nl, 0, nz / nl);
      uv.push(i / GLOW_SIDES, t);
    }
  });
  const idx: number[] = [];
  for (let i = 0; i < GLOW_SIDES; i++) {
    const a0 = i * 2, b0 = ((i + 1) % GLOW_SIDES) * 2;
    idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
  }
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  gGeo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  gGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  gGeo.setIndex(idx);
  const gMat = new THREE.ShaderMaterial({
    vertexShader: glowVert,
    fragmentShader: glowFrag,
    uniforms: { uLight: u.uLight, uGlow: glow, uTime: time, uTeal: { value: TEAL } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const column = new THREE.Mesh(gGeo, gMat);
  column.name = "rift:glow";
  column.renderOrder = 3;
  group.add(column);
  disposables.push(gGeo, gMat);

  // The embers: from points in the lens, below its lip.
  const rnd = seeded(9001);
  const n = RIFT_EMBERS[tier];
  const ePos = new Float32Array(n * 3);
  const eRand = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const uu = (rnd() * 2 - 1) * L * 0.85;
    const [x, z] = crackPoint(uu, (rnd() * 2 - 1) * crackHalfWidth(uu) * 0.8);
    ePos.set([x, F, z], i * 3);
    eRand.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  }
  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute("position", new THREE.BufferAttribute(ePos, 3));
  eGeo.setAttribute("aRand", new THREE.BufferAttribute(eRand, 4));
  const eMat = new THREE.ShaderMaterial({
    vertexShader: emberVert,
    fragmentShader: emberFrag,
    uniforms: { uTime: time, uPR: pr, uLight: u.uLight, uGlow: glow, uTeal: { value: TEAL } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const embers = new THREE.Points(eGeo, eMat);
  embers.frustumCulled = false;
  embers.name = "rift:embers";
  group.add(embers);
  disposables.push(eGeo, eMat);

  group.traverse((o) => (o.raycast = () => {}));
  return {
    group,
    update(t, p) {
      time.value = t;
      pr.value = p;
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
