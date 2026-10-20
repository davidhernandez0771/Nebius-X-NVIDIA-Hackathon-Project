// The underground reactor (reactorPlan.ts lays it out; storyPlan.ts says how much power there is): a
// round cavern of rock with a vertical core of light on its axis, a cage of ribs round it, dashed rings
// that spin up, cables from the walls that light up one after another with pulses running into the
// core, and particles circling it faster and faster. The core's top ring is THE RING: iridescent
// chrome like the logo's ring, it lifts off the cap at full power and the descent dives through it,
// its tube shrinking to nothing as it bursts into the generator's particles.
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { QualityTier } from "../../core/quality";
import { CAVERN, CORE, RING } from "./layout";
import { seeded } from "./particles";
import { CABLES, cablePoint, particleSpeed, RINGS, ringPose, ringSpeed } from "./reactorPlan";
import { OUT, placeUniforms, surfaceFrag, surfaceMaterial } from "./placeShaders";

const [AX, AZ] = CAVERN.axis;
const TEAL = new THREE.Color("#19f5c2");
const WARM = new THREE.Color("#ff9a4a");

export interface ReactorState {
  /** The reactor's light: its place light, gone dark again as the descent bursts THE RING. */
  light: number;
  /** THE RING's own light: the place light alone (it bursts rather than fading). */
  ringLight: number;
  power: number;
  /** 0–1: the top ring lifting into THE RING. */
  lift: number;
  /** 0–1: THE RING bursting (the descent's first moments): its tube shrinks to nothing. */
  burst: number;
  time: number;
  /** Seconds since the last frame, for the spins (they integrate, so a change of speed never jumps). */
  dt: number;
  pr: number;
}

const coreUniforms = () => ({ uPower: { value: 0 }, uTeal: { value: TEAL }, uWarm: { value: WARM }, uAxis: { value: new THREE.Vector2(AX, AZ) } });

const cavernFrag = /* glsl */ `
uniform float uPower, uCeil, uCoreB, uCoreT; uniform vec2 uAxis; uniform vec3 uTeal, uWarm;
void main(){
  if (vW.y > uCeil - 4. && crackSD(vW.xz) < .15) discard;
  float n = fbm3(vW * .22);
  float n2 = vn3(vW * 1.4);
  // Linear: near black rock, lit by the core as it powers up (teal close in, a little warm in the cracks).
  vec3 c = vec3(.0055, .006, .007) * (.4 + n) + .0025 * n2;
  vec3 a = vec3(uAxis.x, clamp(vW.y, uCoreB, uCoreT), uAxis.y);
  float d = distance(vW, a);
  float glow = (.03 + uPower) / (1. + d * d * .005);
  c += c * glow * 7. + uTeal * glow * .012 + uWarm * glow * .004 * n2;
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

const coreFrag = /* glsl */ `
uniform float uPower, uFlow; uniform vec3 uTeal;
void main(){
  vec3 v = normalize(cameraPosition - vW);
  float fres = pow(1. - abs(dot(normalize(vN), v)), 2.);
  float bands = fbm2(vec2(vUv.x * 9., vW.y * .32 - uFlow));
  float streak = smoothstep(.5, .9, bands);
  float lit = .04 + uPower * (.4 + .6 * streak);
  vec3 c = mix(uTeal, vec3(1.), .2 + .45 * uPower) * lit;
  c += vec3(.25, .4, .42) * fres * (.05 + .3 * uPower);
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

const metalFrag = /* glsl */ `
uniform float uPower; uniform vec2 uAxis; uniform vec3 uTeal;
void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  vec3 toAxis = vec3(uAxis.x, vW.y, uAxis.y) - vW;
  float d = length(toAxis);
  float face = max(0., dot(n, toAxis / max(d, .001)));
  vec3 c = vec3(.006, .0065, .0075) * (.7 + .6 * fbm3(vW * 3.));
  c += uTeal * face * (.01 + uPower * .35) / (1. + d * d * .15);
  c += vec3(.03, .04, .045) * pow(1. - max(0., dot(n, v)), 3.) * (.3 + .7 * uPower);
  c += vec3(.02, .025, .028) * max(0., n.y);
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

const ringFrag = /* glsl */ `
uniform float uPower; uniform vec3 uTeal;
void main(){
  // Segments of light on the ring's outer face, so its spin shows; dark metal between.
  float dash = step(.3, fract(vUv.x * 44.)) * smoothstep(.35, .8, cos(vUv.y * 6.2832));
  float lit = (.05 + uPower) * dash;
  vec3 c = mix(vec3(.007, .0075, .0085), mix(uTeal, vec3(1.), .3), clamp(lit, 0., 1.));
  vec3 v = normalize(cameraPosition - vW);
  c += vec3(.04, .05, .055) * pow(1. - max(0., dot(normalize(vN), v)), 3.);
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

const cableVert = /* glsl */ `
attribute float aCable;
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying float vCable;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; vCable = aCable;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// reactorPlan.ts cableLight, mirrored.
const cableFrag = /* glsl */ `
varying float vCable;
uniform float uPower, uN; uniform vec3 uTeal;
void main(){
  float on = .06 + .8 * vCable / max(1., uN - 1.);
  float lit = smoothstep(on, on + .08, uPower);
  float pulse = pow(.5 + .5 * sin(vUv.x * 40. - uTime * (2. + 5. * uPower)), 10.);
  vec3 v = normalize(cameraPosition - vW);
  vec3 c = vec3(.004, .0045, .005) + vec3(.025, .03, .033) * pow(1. - max(0., dot(normalize(vN), v)), 3.);
  c += mix(uTeal, vec3(1.), .2) * lit * (.12 + .8 * pulse) * (.5 + .5 * vUv.x);
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

const sparkVert = /* glsl */ `
attribute vec4 aOrbit; attribute vec4 aRand;
uniform float uTime, uPhase, uPR, uPower; uniform vec2 uAxis;
varying float vA; varying vec3 vC;
void main(){
  float r = aOrbit.x;
  float a = aOrbit.z + uPhase * (2.4 / (.6 + r * .22));
  float rr = r * (1. + .05 * sin(uTime * .7 + aRand.x * 20.)) * (1. - .12 * uPower * aRand.y);
  vec3 p = vec3(uAxis.x + sin(a) * rr, aOrbit.y + sin(uTime * .5 + aRand.y * 30.) * .3 + uPower * aOrbit.w, uAxis.y + cos(a) * rr);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(1.8 * uPR * (.4 + aRand.z) * (30. / max(.5, -mv.z)), 3. * uPR);
  vA = (.06 + .8 * uPower) * (.3 + .7 * aRand.w);
  vC = mix(vec3(.1, .96, .76), vec3(1.), step(.8, aRand.z));
  vC = mix(vC, vec3(1., .6, .29), step(.95, aRand.x));
}`;

const sparkFrag = /* glsl */ `
varying float vA; varying vec3 vC; uniform float uLight;
void main(){ vec2 c = gl_PointCoord - .5; float r = dot(c, c) * 4.; if (r > 1.) discard;
  gl_FragColor = vec4(vC, (1. - r) * vA * uLight);
  ${OUT}
}`;

/** The cavern: a round hall, floor to domed ceiling, seen from inside. */
function cavernGeometry(radial: number): THREE.BufferGeometry {
  const { floor: f, ceiling: c, radius: r } = CAVERN;
  const prof: [number, number][] = [
    [0.01, f],
    [r * 0.8, f],
    [r * 0.97, f + 2],
    [r, f + 10],
    [r * 1.02, f + 30],
    [r, c - 16],
    [r * 0.9, c - 6],
    [r * 0.66, c - 1.2],
    [r * 0.33, c - 0.1],
    [0.01, c + 0.3],
  ];
  return new THREE.LatheGeometry(
    prof.map(([x, y]) => new THREE.Vector2(x, y)),
    radial,
  ).translate(AX, 0, AZ);
}

/** The core's plinth, cap and cage of ribs, as one geometry. */
function metalGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = CORE.top - CORE.bottom;
  parts.push(new THREE.CylinderGeometry(CORE.radius + 1.6, CORE.radius + 2.4, 2.2, 40).translate(AX, CORE.bottom - 0.6, AZ));
  // The cap is a collar, open over the core: from above you look down into the light.
  parts.push(new THREE.CylinderGeometry(CORE.radius + 0.5, CORE.radius + 0.9, 0.9, 40, 1, true).translate(AX, CORE.top + 0.1, AZ));
  parts.push(new THREE.RingGeometry(CORE.radius, CORE.radius + 0.5, 40).rotateX(-Math.PI / 2).translate(AX, CORE.top + 0.55, AZ));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = CORE.radius + 0.7;
    parts.push(new THREE.BoxGeometry(0.22, h, 0.34).rotateY(a).translate(AX + Math.sin(a) * r, CORE.bottom + h / 2, AZ + Math.cos(a) * r));
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/** Every cable as a tube, merged, with its index for the lighting sequence. */
function cableGeometry(radial: number): THREE.BufferGeometry {
  const list = CABLES.map((c, i) => {
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 14 }, (_, k) => new THREE.Vector3(...cablePoint(c, k / 13))));
    const g = new THREE.TubeGeometry(curve, 64, 0.13, radial, false);
    g.setAttribute("aCable", new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(i), 1));
    return g;
  });
  const g = mergeGeometries(list, false)!;
  list.forEach((p) => p.dispose());
  return g;
}

function sparks(n: number): THREE.BufferGeometry {
  const rnd = seeded(57);
  const orbit = new Float32Array(n * 4);
  const rand = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const r = CORE.radius + 0.8 + rnd() ** 1.6 * 9;
    orbit.set([r, CORE.bottom + rnd() * (CORE.top - CORE.bottom + 3), rnd() * Math.PI * 2, rnd() * 2], i * 4);
    rand.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  // The vertex shader places every point; position only sizes the draw.
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("aOrbit", new THREE.BufferAttribute(orbit, 4));
  g.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));
  return g;
}

/** THE RING: the logo ring's chrome, its tube scaled about its centre line (uTube 0–1) as it bursts. */
function makeTheRing(low: boolean, env: THREE.Texture) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x8e979b,
    metalness: 1,
    roughness: 0.2,
    iridescence: 1,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [180, 820],
    envMap: env,
    envMapIntensity: 0.9,
    emissive: TEAL.clone(),
    emissiveIntensity: 0,
  });
  const tube = { value: 1 };
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTube = tube;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTube;").replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
  vec3 ringC = vec3(normalize(transformed.xy) * ${RING.radius.toFixed(3)}, 0.0);
  transformed = ringC + (transformed - ringC) * uTube;`,
    );
  };
  const geo = new THREE.TorusGeometry(RING.radius, RING.tube, low ? 24 : 48, low ? 96 : 200);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "intro:the-ring";
  mesh.raycast = () => {};
  return { mesh, mat, tube, dispose: () => (geo.dispose(), mat.dispose()) };
}

export interface ReactorHandle {
  group: THREE.Group;
  update(s: ReactorState): void;
  dispose(): void;
}

export function useReactor(quality: QualityTier): ReactorHandle {
  const gl = useThree((s) => s.gl);
  const low = quality.name === "low";
  const handle = useMemo<ReactorHandle>(() => {
    const u = placeUniforms({ k: 0.011, mistY: CAVERN.floor + 1, mistK: 0.12, fog: "#081013", mist: "#10242a" });
    const cu = coreUniforms();
    const flow = { value: 0 };
    const phase = { value: 0 };
    const pr = { value: 1 };
    const group = new THREE.Group();
    group.name = "intro:reactor";
    const add = <T extends THREE.Object3D>(o: T, name: string) => {
      o.raycast = () => {};
      o.name = name;
      group.add(o);
      return o;
    };

    const cavernGeo = cavernGeometry(low ? 40 : 72);
    const cavernMat = surfaceMaterial(u, { ...cu, uCeil: { value: CAVERN.ceiling }, uCoreB: { value: CORE.bottom }, uCoreT: { value: CORE.top } }, cavernFrag, { side: THREE.BackSide });
    add(new THREE.Mesh(cavernGeo, cavernMat), "reactor:cavern");

    // The column, open at the top, and the source at its foot: from above, a well of light.
    const tube = new THREE.CylinderGeometry(CORE.radius, CORE.radius, CORE.top - CORE.bottom, low ? 24 : 48, 1, true).translate(AX, (CORE.top + CORE.bottom) / 2, AZ);
    const source = new THREE.CircleGeometry(CORE.radius, 32).rotateX(-Math.PI / 2).translate(AX, CORE.bottom + 0.6, AZ);
    const coreGeo = mergeGeometries([tube.toNonIndexed(), source.toNonIndexed()], false)!;
    tube.dispose();
    source.dispose();
    const coreMat = surfaceMaterial(u, { ...cu, uFlow: flow }, coreFrag, { side: THREE.DoubleSide });
    add(new THREE.Mesh(coreGeo, coreMat), "reactor:core");

    const metalGeo = metalGeometry();
    const metalMat = surfaceMaterial(u, cu, metalFrag);
    add(new THREE.Mesh(metalGeo, metalMat), "reactor:cage");

    const ringGeo = new THREE.TorusGeometry(1, 0.05, low ? 8 : 12, low ? 128 : 220);
    const ringMat = surfaceMaterial(u, cu, ringFrag);
    const rings = add(new THREE.InstancedMesh(ringGeo, ringMat, RINGS.length), "reactor:rings");
    rings.frustumCulled = false;
    const spins = RINGS.map(() => 0);

    const cableGeo = cableGeometry(low ? 4 : 6);
    const cableMat = new THREE.ShaderMaterial({
      vertexShader: cableVert,
      fragmentShader: surfaceFrag(cableFrag),
      uniforms: { ...u, ...cu, uN: { value: CABLES.length } },
    });
    add(new THREE.Mesh(cableGeo, cableMat), "reactor:cables");

    const sparkGeo = sparks(low ? 3000 : 12000);
    const sparkMat = new THREE.ShaderMaterial({
      vertexShader: sparkVert,
      fragmentShader: sparkFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uLight: u.uLight, uTime: u.uTime, uPhase: phase, uPR: pr, uPower: cu.uPower, uAxis: cu.uAxis },
    });
    const sparkPts = add(new THREE.Points(sparkGeo, sparkMat), "reactor:particles");
    sparkPts.frustumCulled = false;

    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const ring = makeTheRing(low, env);
    add(ring.mesh, "intro:the-ring");

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const disposables = [cavernGeo, cavernMat, coreGeo, coreMat, metalGeo, metalMat, ringGeo, ringMat, cableGeo, cableMat, sparkGeo, sparkMat, env];

    return {
      group,
      update(s) {
        const p = s.power;
        u.uLight.value = s.light;
        u.uTime.value = s.time;
        cu.uPower.value = p;
        pr.value = s.pr;
        flow.value += s.dt * (0.15 + 2.6 * p);
        phase.value += s.dt * particleSpeed(p);
        RINGS.forEach((r, i) => {
          spins[i] += s.dt * ringSpeed(p) * r.dir * (1 + i * 0.15);
          e.set(-Math.PI / 2 + r.tilt * Math.sin(spins[i] * 0.37), 0, spins[i]);
          m.compose(new THREE.Vector3(AX, r.y, AZ), q.setFromEuler(e), new THREE.Vector3(r.radius, r.radius, r.radius));
          rings.setMatrixAt(i, m);
        });
        rings.instanceMatrix.needsUpdate = true;
        const rp = ringPose(s.lift);
        ring.mesh.position.set(...rp.center);
        ring.mesh.scale.setScalar(rp.radius / RING.radius);
        ring.mesh.rotation.set(-Math.PI / 2, 0, s.time * 0.08 + spins[0] * 0.2);
        ring.tube.value = 1 - s.burst;
        ring.mat.envMapIntensity = 0.9 * s.ringLight;
        ring.mat.emissiveIntensity = (0.02 + 0.14 * p * p) * s.ringLight * (1 - s.burst);
        ring.mat.iridescenceThicknessRange[1] = 700 + 220 * Math.sin(s.time * 0.7);
        ring.mesh.visible = s.ringLight > 0 && s.burst < 0.999;
        // The rest of the reactor only while its light is up.
        for (const c of group.children) if (c !== ring.mesh) c.visible = s.light > 0;
        group.visible = s.light > 0 || ring.mesh.visible;
      },
      dispose() {
        rings.dispose();
        ring.dispose();
        disposables.forEach((d) => d.dispose());
      },
    };
  }, [gl, low]);
  useEffect(() => () => handle.dispose(), [handle]);
  return handle;
}
