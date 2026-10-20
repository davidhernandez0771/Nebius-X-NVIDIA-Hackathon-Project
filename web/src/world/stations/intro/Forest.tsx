// The forest floor at night (forestPlan.ts lays it out): instanced dark trunks flaring into their
// roots, a mossy floor with pools of light under the shafts, the shafts themselves, drifting dust, and
// the robot's own parts (the Franka's URDF meshes) half buried in the moss, faintly lit. In the floor is
// the crack, with a cold glow far down its fissure: the camera looks into it and drops through. All of
// it fades with the forest's light (storyPlan.ts); nothing is drawn while that is 0.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { QualityTier } from "../../core/quality";
import { crackHalfWidth, PART_KINDS, parts, shafts, trees, type Part, type PartKind } from "./forestPlan";
import { CRACK, FOREST, ROCK } from "./layout";
import { seeded } from "./particles";
import { walkXZ } from "./path";
import { OUT, placeUniforms, surfaceMaterial, type PlaceUniforms } from "./placeShaders";

const F = FOREST.floor;
const MOON = new THREE.Vector3(-0.45, 1, 0.3).normalize();
const TEAL = new THREE.Color("#19f5c2");
const MESH_URL = `${(import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/")}robots/franka_description/meshes/collision/`;

/** The crack's fissure glows a little as the camera nears it (0–1 from the Places). */
export interface ForestState {
  light: number;
  glow: number;
  time: number;
  /** The renderer's pixel ratio, for the dust's point size. */
  pr: number;
}

const groundFrag = /* glsl */ `
uniform vec4 uShafts[8]; uniform float uGlow; uniform vec3 uTeal;
void main(){
  float sd = crackSD(vW.xz);
  if (sd < 0.) discard;
  vec2 p = vW.xz;
  float n = fbm2(p * .35);
  float moss = smoothstep(.42, .68, fbm2(p * .17 + 3.1));
  // Linear colours: near black soil, mossy patches a shade greener, fine grain.
  vec3 c = mix(vec3(.0062, .0058, .0052), vec3(.0068, .0118, .0092), moss) * (.55 + .9 * n) * (.8 + .4 * vn2(p * 5.));
  float pool = 0.;
  for (int i = 0; i < 8; i++){ vec4 s = uShafts[i]; vec2 d = p - s.xy; pool += s.w * exp(-dot(d, d) / (s.z * s.z)); }
  c += vec3(.045, .058, .068) * pool * (.7 + .6 * n);
  // The lip: darker, then a thin cold glow from far below.
  c *= 1. - .8 * (1. - smoothstep(0., .9, sd));
  c += uTeal * uGlow * .03 * (1. - smoothstep(0., .6, sd));
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

const trunkFrag = /* glsl */ `
uniform vec3 uMoon; uniform float uFloor, uCanopy;
void main(){
  vec3 n = normalize(vN);
  float bark = fbm2(vec2(vUv.x * 26., vW.y * .55));
  // Near black bark, a cold edge where the moon catches it: silhouettes against the mist.
  vec3 c = vec3(.0045, .0042, .004) * (.5 + 1.0 * bark);
  c += vec3(.012, .017, .022) * max(0., dot(n, uMoon));
  vec3 v = normalize(cameraPosition - vW);
  c += vec3(.014, .02, .025) * pow(1. - max(0., dot(n, v)), 3.);
  float foot = 1. - smoothstep(uFloor, uFloor + 1.8, vW.y);
  c = mix(c, vec3(.005, .009, .007) * (.6 + .8 * bark), foot * .7);
  // Up into the dark: no canopy, the trunks go on into the night.
  c = mix(c, uFog, smoothstep(uFloor + uCanopy * .35, uFloor + uCanopy * .95, vW.y));
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

const partFrag = /* glsl */ `
uniform vec3 uMoon, uTeal; uniform float uFloor;
void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float grime = fbm3(vW * 2.2);
  // The robot's white shell, dirty, lit only by the moon: pale shapes in the dark.
  vec3 shell = vec3(.42, .43, .41) * (.55 + .6 * grime);
  vec3 c = shell * (.025 + .2 * max(0., dot(n, uMoon)));
  vec3 h = normalize(uMoon + v);
  c += vec3(.16, .19, .21) * pow(max(0., dot(n, h)), 30.);
  float rim = pow(1. - max(0., dot(n, v)), 3.);
  c += mix(vec3(.02, .028, .032), uTeal * .05, .4) * rim;
  // Panel seams round the joint axis, one of them still faintly powered.
  float f = abs(fract(vUv.x * 9.) - .5);
  c *= 1. - .6 * smoothstep(.44, .49, f);
  c += uTeal * .05 * smoothstep(.46, .5, abs(fract(vUv.x * 3. + .25) - .5));
  // Moss creeping up from where it's buried.
  c = mix(c, vec3(.005, .009, .007) * (.6 + .7 * grime), 1. - smoothstep(uFloor - .05, uFloor + .45, vW.y));
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

const fissureFrag = /* glsl */ `
uniform float uTop, uBottom, uGlow; uniform vec3 uTeal;
void main(){
  float depth = clamp((uTop - vW.y) / (uTop - uBottom), 0., 1.);
  float n = fbm3(vW * .55);
  vec3 c = vec3(.006, .006, .007) * (.45 + n) * (1. - smoothstep(0., .45, depth) * .92);
  // The cold light from far below, past the fog: it is what the camera follows down.
  vec3 glow = uTeal * uGlow * smoothstep(.45, 1., depth) * .1 * (.5 + .7 * n);
  gl_FragColor = vec4(place(c, vW) + glow * uLight, 1.);
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
  float fall = smoothstep(0., .06, vUv.y) * (1. - vUv.y * .9);
  float flick = .7 + .3 * vn2(vec2(vUv.x * 3. + uTime * .05, vUv.y * 2. - uTime * .03));
  float d = distance(vW, cameraPosition);
  float a = edge * fall * flick * smoothstep(1.5, 7., d) * exp(-d * uFogK * .7) * .07 * uLight;
  gl_FragColor = vec4(vec3(.42, .52, .6), a);
  ${OUT}
}`;

const dustVert = /* glsl */ `
attribute vec4 aRand; uniform float uTime, uPR;
varying float vA;
void main(){
  vec3 p = position;
  p.y = ${F.toFixed(1)} + mod(p.y - ${F.toFixed(1)} + uTime * (.05 + aRand.x * .1), 14.);
  p.x += sin(uTime * .2 + aRand.y * 20.) * .5; p.z += cos(uTime * .16 + aRand.z * 20.) * .5;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(1.4 * uPR * (.4 + aRand.w) * (20. / max(.5, -mv.z)), 3. * uPR);
  vA = (.15 + .35 * aRand.y) * exp(-(-mv.z) * .05);
}`;

const dustFrag = /* glsl */ `
varying float vA; uniform float uLight;
void main(){ vec2 c = gl_PointCoord - .5; float r = dot(c, c) * 4.; if (r > 1.) discard;
  gl_FragColor = vec4(vec3(.7, .8, .85), (1. - r) * vA * uLight);
  ${OUT}
}`;

/** A trunk of height 1 and radius 1 at chest height, flaring into its roots at the bottom. */
function trunkGeometry(radial: number): THREE.BufferGeometry {
  const ys = [-0.01, 0, 0.004, 0.01, 0.018, 0.03, 0.05, 0.08, 0.15, 0.4, 0.7, 1];
  const pts = ys.map((y) => new THREE.Vector2(Math.max(0.05, 1 + 1.5 * Math.exp(-Math.max(0, y) / 0.018) - 0.35 * y), y));
  return new THREE.LatheGeometry(pts, radial);
}

/** The fissure: the crack's outline carried straight down through the rock. */
function fissureGeometry(): THREE.BufferGeometry {
  const L = CRACK.halfLength;
  const dir = [Math.cos(CRACK.angle), -Math.sin(CRACK.angle)];
  const across = [Math.sin(CRACK.angle), Math.cos(CRACK.angle)];
  const loop: [number, number][] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const u = -L + (2 * L * i) / N;
    loop.push([u, crackHalfWidth(u)]);
  }
  for (let i = N - 1; i > 0; i--) {
    const u = -L + (2 * L * i) / N;
    loop.push([u, -crackHalfWidth(u)]);
  }
  const top = F + 0.02;
  const bottom = ROCK.bottom - 1;
  const pos: number[] = [];
  const at = ([u, v]: [number, number], y: number) => [CRACK.center[0] + u * dir[0] + v * across[0], y, CRACK.center[1] + u * dir[1] + v * across[1]];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    pos.push(...at(a, top), ...at(b, top), ...at(a, bottom), ...at(b, top), ...at(b, bottom), ...at(a, bottom));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length).fill(0), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  return g;
}

/** Two crossed quads per shaft, leaning with the moon. */
function shaftGeometry(list: ReturnType<typeof shafts>): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const h = FOREST.canopy * 1.1;
  const lean = [MOON.x * h * 0.35, MOON.z * h * 0.35];
  for (const s of list) {
    for (const a of [0.3, 0.3 + Math.PI / 2]) {
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const b0 = [s.x - dx * s.radius, F, s.z - dz * s.radius];
      const b1 = [s.x + dx * s.radius, F, s.z + dz * s.radius];
      const t0 = [s.x + lean[0] - dx * s.radius * 1.7, F + h, s.z + lean[1] - dz * s.radius * 1.7];
      const t1 = [s.x + lean[0] + dx * s.radius * 1.7, F + h, s.z + lean[1] + dz * s.radius * 1.7];
      pos.push(...b0, ...b1, ...t1, ...b0, ...t1, ...t0);
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function dustPoints(n: number, u: PlaceUniforms, pr: { value: number }): THREE.Points {
  const rnd = seeded(91);
  const walk = walkXZ();
  const pos = new Float32Array(n * 3);
  const rand = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const [wx, wz] = walk[Math.floor(rnd() * walk.length)];
    pos.set([wx + (rnd() - 0.5) * 26, F + rnd() * 14, wz + (rnd() - 0.5) * 26], i * 3);
    rand.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));
  const m = new THREE.ShaderMaterial({
    vertexShader: dustVert,
    fragmentShader: dustFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uLight: u.uLight, uTime: u.uTime, uPR: pr },
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

/** The parts, from the robot's collision meshes, posed and merged into one geometry. */
function partsGeometry(meshes: Record<PartKind, THREE.BufferGeometry>, list: Part[]): THREE.BufferGeometry {
  const out: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const box = new THREE.Box3();
  for (const p of list) {
    const g = meshes[p.kind].clone();
    g.center();
    // The mesh's own z (its joint axis, in mesh metres) rides in uv.x: the shader rings it with seams.
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) uv[i * 2] = pos.getZ(i);
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    m.compose(new THREE.Vector3(), q.setFromEuler(new THREE.Euler(...p.rot)), new THREE.Vector3(p.scale, p.scale, p.scale));
    g.applyMatrix4(m);
    box.setFromBufferAttribute(g.attributes.position as THREE.BufferAttribute);
    const h = box.max.y - box.min.y;
    g.translate(p.x, F - box.min.y - p.sink * h, p.z);
    out.push(g);
  }
  const merged = mergeGeometries(out, false) ?? new THREE.BufferGeometry();
  out.forEach((g) => g.dispose());
  return merged;
}

export interface ForestHandle {
  group: THREE.Group;
  update(s: ForestState): void;
  dispose(): void;
}

export function useForest(quality: QualityTier): ForestHandle {
  const low = quality.name === "low";
  const handle = useMemo<ForestHandle>(() => {
    const walk = walkXZ();
    const forest = trees(low ? 90 : 150, 7, walk);
    const shaftList = shafts(3, walk, forest, low ? 5 : 8);
    const partList = parts(5, walk, forest);
    const u = placeUniforms({ k: 0.045, mistY: F + 0.3, mistK: 0.5, fog: "#141b20", mist: "#25313a" });
    const pr = { value: 1 };
    const glow = { value: 0 };
    const group = new THREE.Group();
    group.name = "intro:forest";
    const disposables: { dispose(): void }[] = [];
    const add = <T extends THREE.Object3D>(o: T) => {
      o.raycast = () => {};
      group.add(o);
      return o;
    };

    // The floor: a disc round the forest, the crack cut out of it.
    const shaftU = Array.from({ length: 8 }, (_, i) => {
      const s = shaftList[i];
      return s ? new THREE.Vector4(s.x, s.z, s.radius * 1.6, 1) : new THREE.Vector4(0, 0, 1, 0);
    });
    const groundGeo = new THREE.CircleGeometry(FOREST.radius + 30, low ? 48 : 96).rotateX(-Math.PI / 2).translate(FOREST.center[0], F, FOREST.center[1]);
    const groundMat = surfaceMaterial(u, { uShafts: { value: shaftU }, uGlow: glow, uTeal: { value: TEAL } }, groundFrag);
    add(new THREE.Mesh(groundGeo, groundMat)).name = "forest:floor";

    // The night behind it all, so the far mist and the trunks' tops fade into one sky.
    const skyGeo = new THREE.SphereGeometry(110, 32, 16).translate(FOREST.center[0], F, FOREST.center[1]);
    const skyMat = surfaceMaterial(u, { uCenter: { value: new THREE.Vector3(FOREST.center[0], F, FOREST.center[1]) } }, skyFrag, { side: THREE.BackSide, depthWrite: false });
    const sky = add(new THREE.Mesh(skyGeo, skyMat));
    sky.name = "forest:sky";
    sky.renderOrder = -5;
    sky.frustumCulled = false;

    // The trunks: one instanced draw.
    const trunkGeo = trunkGeometry(low ? 7 : 11);
    const trunkMat = surfaceMaterial(u, { uMoon: { value: MOON }, uFloor: { value: F }, uCanopy: { value: FOREST.canopy } }, trunkFrag);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, forest.length);
    const mx = new THREE.Matrix4();
    forest.forEach((t, i) => {
      mx.compose(new THREE.Vector3(t.x, F, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(t.lean[0], i * 1.7, t.lean[1])), new THREE.Vector3(t.radius, t.height, t.radius));
      trunks.setMatrixAt(i, mx);
    });
    trunks.frustumCulled = false;
    add(trunks).name = "forest:trunks";

    // The fissure under the crack.
    const fissureGeo = fissureGeometry();
    const fissureMat = surfaceMaterial(u, { uTop: { value: F }, uBottom: { value: ROCK.bottom }, uGlow: glow, uTeal: { value: TEAL } }, fissureFrag, { side: THREE.DoubleSide });
    add(new THREE.Mesh(fissureGeo, fissureMat)).name = "forest:fissure";

    // The shafts, additive.
    const shaftGeo = shaftGeometry(shaftList);
    const shaftMat = new THREE.ShaderMaterial({
      vertexShader: shaftVert,
      fragmentShader: shaftFrag,
      uniforms: { uLight: u.uLight, uTime: u.uTime, uFogK: u.uFogK },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const shaftMesh = add(new THREE.Mesh(shaftGeo, shaftMat));
    shaftMesh.name = "forest:shafts";
    shaftMesh.renderOrder = 2;

    const dust = add(dustPoints(low ? 700 : 2400, u, pr));
    dust.name = "forest:dust";

    // The robot parts: a placeholder until the meshes stream in (so the shader compiles with the rest).
    const partMat = surfaceMaterial(u, { uMoon: { value: MOON }, uTeal: { value: TEAL }, uFloor: { value: F } }, partFrag);
    const partMesh = add(new THREE.Mesh<THREE.BufferGeometry>(new THREE.BoxGeometry(0.01, 0.01, 0.01).translate(0, F - 1, 0), partMat));
    partMesh.name = "forest:parts";
    let live = true;
    const loader = new STLLoader(new THREE.LoadingManager());
    Promise.all(PART_KINDS.map((k) => loader.loadAsync(`${MESH_URL}${k}.stl`).then((g) => [k, g] as const)))
      .then((list) => {
        const meshes = Object.fromEntries(list) as Record<PartKind, THREE.BufferGeometry>;
        if (live) {
          partMesh.geometry.dispose();
          partMesh.geometry = partsGeometry(meshes, partList);
        }
        list.forEach(([, g]) => g.dispose());
      })
      .catch((e) => console.warn("world: the forest's robot parts didn't load", e));

    disposables.push(skyGeo, skyMat, groundGeo, groundMat, trunkGeo, trunkMat, fissureGeo, fissureMat, shaftGeo, shaftMat, dust.geometry, dust.material as THREE.Material, partMat);
    return {
      group,
      update(s) {
        u.uLight.value = s.light;
        u.uTime.value = s.time;
        glow.value = s.glow;
        pr.value = s.pr;
        group.visible = s.light > 0;
      },
      dispose() {
        live = false;
        partMesh.geometry.dispose();
        trunks.dispose();
        disposables.forEach((d) => d.dispose());
      },
    };
  }, [low]);
  useEffect(() => () => handle.dispose(), [handle]);
  return handle;
}

