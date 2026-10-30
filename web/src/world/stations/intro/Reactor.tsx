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
import { CABLES, cablePoint, particleSpeed, pulseSpeed, RINGS, ringPose, ringSpeed, sparkRate } from "./reactorPlan";
import { buildReactorDetail } from "./reactorGeometry";
import { OUT, placeUniforms, surfaceFrag, surfaceMaterial } from "./placeShaders";

const [AX, AZ] = CAVERN.axis;
const TEAL = new THREE.Color("#19f5c2");
const WARM = new THREE.Color("#ff9a4a");
const WHITE = new THREE.Color(1, 1, 1);

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

// The core (polish, 2026-10-27, the user: "make the ring/reactor inside more realistic"). Outside, a glass column of
// light (the bands flowing up it). Inside, what you see looking down the well from THE RING and diving in: a steel
// liner of stacked rings and vertical seams, slots between the seams where the plasma shows, all lit more the deeper
// it goes (the glow falls off up the well, not one flat colour), the light catching the liner's lips; and at the foot
// the source, a hot disc that is white at the middle and teal at its rim, turning slowly, with rings of heat running
// out from its middle. The colours stay the brand's teal and white (no green, no eye).
const coreFrag = /* glsl */ `
uniform float uPower, uFlow; uniform vec2 uAxis; uniform vec3 uTeal;
const float CB = ${CORE.bottom.toFixed(2)}, CT = ${CORE.top.toFixed(2)}, CR = ${CORE.radius.toFixed(3)};
void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  vec3 hot = mix(uTeal, vec3(1.), .55);
  vec3 c;
  // Light made inside the well (not fogged: the cavern's mist is outside it).
  vec3 e = vec3(0.);
  if (abs(n.y) > .5) {
    // The source: a radial falloff from a white-hot middle to a teal rim, slow swirls and heat rings running out.
    vec2 q = (vW.xz - uAxis) / CR;
    float r = length(q);
    float a = atan(q.y, q.x);
    float swirl = fbm2(vec2(a * 2.2 + r * 3. - uFlow * .35, r * 5. - uFlow * .6));
    float rings = pow(max(.5 + .5 * sin(r * 26. - uFlow * 4.), 0.), 6.) * (1. - r);
    float core = exp(-r * r * 6.);
    float k = (.05 + uPower) * (.5 * core + .25 * (.6 + .8 * swirl) * (1. - r * r) + .3 * rings);
    // The rim, where the liner meets it: dark.
    c = vec3(.004, .005, .006);
    e = mix(uTeal, vec3(1.), .25 + .6 * core) * k * smoothstep(1., .86, r);
  } else if (gl_FrontFacing) {
    // Outside: the glass column of light.
    float fres = pow(max(1. - abs(dot(n, v)), 0.), 2.);
    float bands = fbm2(vec2(vUv.x * 9., vW.y * .32 - uFlow));
    float streak = smoothstep(.5, .9, bands);
    float lit = .04 + uPower * (.4 + .6 * streak);
    c = mix(uTeal, vec3(1.), .2 + .45 * uPower) * lit;
    c += vec3(.25, .4, .42) * fres * (.05 + .3 * uPower);
  } else {
    // Inside: the liner. h is how far up the well (0 the source, 1 the mouth).
    float h = clamp((vW.y - CB) / (CT - CB), 0., 1.);
    float deep = (1. - h) * (1. - h);
    float ring = fract(vW.y / 1.15);
    float lip = smoothstep(.0, .05, ring) * smoothstep(.16, .05, ring);
    float seamX = fract(vUv.x * 24.);
    float seam = smoothstep(.04, 0., min(seamX, 1. - seamX));
    float slot = step(.42, seamX) * step(seamX, .58) * step(.3, ring) * step(ring, .85);
    float plasma = smoothstep(.35, .85, fbm2(vec2(vUv.x * 30., vW.y * .5 - uFlow * 1.4)));
    // Steel, darker at the seams, picking up the source's light more the deeper it is.
    vec3 steel = vec3(.009, .010, .012) * (.65 + .7 * fbm2(vec2(vUv.x * 60., vW.y * 3.)));
    c = steel * (1. - .5 * seam);
    e = hot * steel * 30. * deep * (.1 + uPower);
    // The lips of the rings catch the light from below; the slots show the plasma behind.
    e += hot * lip * (.015 + .35 * uPower) * (.2 + .8 * deep);
    e += mix(uTeal, vec3(1.), .3) * slot * (.03 + uPower * (.25 + .75 * plasma)) * (.25 + .75 * deep);
    // A soft spill of glow up the well over everything.
    e += uTeal * (.004 + .06 * uPower) * deep;
  }
  gl_FragColor = vec4(place(c, vW) + e * uLight, 1.);
  ${OUT}
}`;

// The steel (the plinth, the cap's collar, the cage's ribs, the cable clamps): brushed panels with seams and a bolt at
// each corner, the core's light on the faces turned to it with a highlight that moves as the camera goes round, and on
// the collar's top (the mouth of the well, under THE RING) a glowing lip where the light spills over.
const metalFrag = /* glsl */ `
uniform float uPower; uniform vec2 uAxis; uniform vec3 uTeal;
const float CT = ${CORE.top.toFixed(2)}, CR = ${CORE.radius.toFixed(3)};
void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  vec3 toAxis = vec3(uAxis.x, clamp(vW.y, ${CORE.bottom.toFixed(2)}, CT), uAxis.y) - vW;
  float d = length(toAxis);
  vec3 l = toAxis / max(d, .001);
  float face = max(0., dot(n, l));
  // Panels: a grid round the axis and up, seams between, a bolt in each corner; brushed along y.
  vec2 rel = vW.xz - uAxis;
  float around = atan(rel.y, rel.x) * 3.8197;
  vec2 cell = fract(vec2(around, vW.y / 1.6));
  float seam = smoothstep(.025, 0., min(min(cell.x, 1. - cell.x), min(cell.y, 1. - cell.y)));
  float bolt = smoothstep(.06, .035, length(min(cell, 1. - cell) - vec2(.07)));
  float brushed = .7 + .5 * fbm2(vec2(around * 40., vW.y * 1.2)) + .15 * vn2(vec2(around * 300., vW.y * 2.));
  vec3 c = vec3(.006, .0065, .0075) * brushed * (1. - .45 * seam) + vec3(.03, .034, .038) * bolt;
  // The core's light: diffuse on the faces turned to it, falling off with distance, and a tight highlight.
  float fall = 1. / (1. + d * d * .15);
  c += uTeal * face * (.01 + uPower * .35) * fall;
  vec3 hv = normalize(l + v);
  c += mix(uTeal, vec3(1.), .5) * pow(max(dot(n, hv), 0.), 48.) * (.02 + uPower * .5) * fall * brushed;
  c += vec3(.03, .04, .045) * pow(max(1. - max(0., dot(n, v)), 0.), 3.) * (.3 + .7 * uPower);
  c += vec3(.02, .025, .028) * max(0., n.y);
  // The collar's top: the light spilling over the mouth of the well, brightest at its inner edge.
  float top = step(.9, n.y) * step(CT + .3, vW.y) * step(vW.y, CT + .8);
  float lipR = 1. - smoothstep(CR, CR + .45, length(rel));
  c += mix(uTeal, vec3(1.), .4) * top * lipR * lipR * (.02 + .6 * uPower);
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

const ringFrag = /* glsl */ `
uniform float uPower; uniform vec3 uTeal;
void main(){
  vec3 v = normalize(cameraPosition - vW);
  float rim = pow(max(1. - max(0., dot(normalize(vN), v)), 0.), 3.);
  vec3 c;
  if (vUv.y < -.5) {
    // A bolt head: bright steel catching the core's light.
    c = vec3(.03, .034, .038) + mix(uTeal, vec3(1.), .5) * (.03 + .25 * uPower) * rim + vec3(.05) * rim;
  } else if (vUv.y > 2.5) {
    // The inner flange: dark steel.
    c = vec3(.006, .0065, .0072) + vec3(.03, .036, .04) * rim;
  } else {
    // Segments of light on the ring's outer face, so its spin shows; dark metal between.
    float dash = step(.3, fract(vUv.x * 44.)) * smoothstep(.35, .8, cos(vUv.y * 6.2832));
    float lit = (.05 + uPower) * dash;
    c = mix(vec3(.007, .0075, .0085), mix(uTeal, vec3(1.), .3), clamp(lit, 0., 1.));
    c += vec3(.04, .05, .055) * rim;
  }
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

// reactorPlan.ts cableLight and cableFront, mirrored. The charge fills a cable from its junction box (s 0) to the
// core (s 1) as the power climbs (the scroll), with a bright head at the front; pulses run along the lit part toward
// the core, quickening with the power (uPulse integrates reactorPlan.pulseSpeed, so a change of speed never jumps).
const cableFrag = /* glsl */ `
varying float vCable;
uniform float uPower, uN, uPulse; uniform vec3 uTeal;
void main(){
  float on = .06 + .8 * vCable / max(1., uN - 1.);
  float lit = smoothstep(on, on + .08, uPower);
  float front = smoothstep(on - .04, on + .06, uPower);
  float s = vUv.x;
  float charged = smoothstep(front + .02, front - .02, s) * step(.001, front);
  float head = exp(-pow(abs((s - front) * 30.), 2.)) * step(.001, front) * (1. - step(.999, front));
  float pulse = pow(max(.5 + .5 * sin(s * 34. - uPulse * 6.2832 * 2. + vCable * 1.7), 0.), 12.);
  vec3 v = normalize(cameraPosition - vW);
  vec3 c = vec3(.004, .0045, .005) + vec3(.025, .03, .033) * pow(max(1. - max(0., dot(normalize(vN), v)), 0.), 3.);
  vec3 energy = mix(uTeal, vec3(1.), .2);
  c += energy * charged * (.06 + .14 * lit + .8 * pulse * lit) * (.55 + .45 * s);
  c += mix(energy, vec3(1.), .5) * head * .9;
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

// The core's cladding: dark steel panels with rows of vents that glow with the power, a bolt in each corner, and a
// lit seam along their edges once the reactor is running.
const panelFrag = /* glsl */ `
uniform float uPower, uFlow; uniform vec3 uTeal;
void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float x = vUv.x, y = vUv.y;
  vec3 c = vec3(.0065, .007, .008) * (.75 + .5 * fbm3(vW * 4.));
  float vent = step(.22, x) * step(x, .78) * step(.5, fract(y * 14.)) * step(.08, y) * step(y, .92);
  float breathe = .65 + .35 * sin(uFlow * 3. + vW.y * .8);
  c += mix(uTeal, vec3(1.), .25) * vent * (.02 + .9 * uPower * uPower) * breathe;
  vec2 corner = vec2(min(x, 1. - x), min(y, 1. - y) * 4.);
  float bolt = smoothstep(.05, .03, length(corner - vec2(.08, .2)));
  c += vec3(.04, .045, .05) * bolt;
  float edge = smoothstep(.03, 0., min(x, 1. - x));
  c += uTeal * edge * .25 * uPower;
  c += vec3(.03, .036, .04) * pow(max(1. - max(0., abs(dot(n, v))), 0.), 3.);
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

// The junction boxes: steel; a lamp strip that lights with the first of its cables.
const junctionFrag = /* glsl */ `
uniform float uPower, uN; uniform vec3 uTeal, uWarm;
void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  vec3 c = vec3(.0055, .006, .007) * (.7 + .6 * fbm3(vW * 3.));
  c += vec3(.03, .036, .04) * pow(max(1. - max(0., dot(n, v)), 0.), 3.);
  if (vUv.y > 1.5) {
    float on = .06 + .8 * (vUv.x * 4.) / max(1., uN - 1.);
    float lit = smoothstep(on, on + .08, uPower);
    c = mix(uWarm * .25, mix(uTeal, vec3(1.), .3), lit) * (.3 + .9 * lit);
  }
  gl_FragColor = vec4(place(c, vW), 1.);
  ${OUT}
}`;

// Sparks at full power: each point is born on the top ring (as it lifts into THE RING) or a ring below, flies out and
// falls under gravity in its own cycle, and only a sparkRate share of them is live.
const flareVert = /* glsl */ `
attribute vec4 aRand;
uniform float uTime, uRate, uPR; uniform vec3 uTop; uniform float uTopR; uniform vec2 uAxis; uniform vec4 uRingY, uRingR;
varying float vA;
void main(){
  float period = .7 + aRand.x * .9;
  float t = fract(uTime / period + aRand.y);
  float fromTop = step(.45, aRand.z);
  float a = aRand.w * 6.2832;
  int k = int(aRand.z * 7.99);
  float ry = k == 0 ? uRingY.x : k == 1 ? uRingY.y : k == 2 ? uRingY.z : uRingY.w;
  float rr = k == 0 ? uRingR.x : k == 1 ? uRingR.y : k == 2 ? uRingR.z : uRingR.w;
  vec3 origin = mix(vec3(uAxis.x + cos(a) * rr, ry, uAxis.y + sin(a) * rr), uTop + vec3(cos(a), 0., sin(a)) * uTopR, fromTop);
  vec3 vel = vec3(cos(a), 0., sin(a)) * (2. + 4. * aRand.x) + vec3(0., 2.5 + 4. * aRand.y, 0.);
  vec3 p = origin + vel * t + vec3(0., -9.8, 0.) * t * t * .5;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(2.4 * uPR * (30. / max(.5, -mv.z)), 4. * uPR);
  vA = step(aRand.x, uRate) * (1. - t) * (1. - t);
}`;

const flareFrag = /* glsl */ `
varying float vA; uniform float uLight;
void main(){ vec2 c = gl_PointCoord - .5; float r = dot(c, c) * 4.; if (r > 1.) discard;
  gl_FragColor = vec4(mix(vec3(1., .75, .45), vec3(.8, 1., .95), r), (1. - r) * vA * uLight);
  ${OUT}
}`;

function flares(n: number): THREE.BufferGeometry {
  const rnd = seeded(61);
  const rand = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) rand.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));
  return g;
}

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
  // The core's light on it from below and from inside the ring (its underside and inner face), as the power climbs.
  const glow = { value: new THREE.Color(0, 0, 0) };
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTube = tube;
    s.uniforms.uCoreGlow = glow;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTube;\nvarying float vUnder;").replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
  vec3 ringC = vec3(normalize(transformed.xy) * ${RING.radius.toFixed(3)}, 0.0);
  transformed = ringC + (transformed - ringC) * uTube;
  // Local z is up once the ring lies flat: its underside and its inner face look at the core.
  vUnder = clamp(-objectNormal.z, 0., 1.) * .7 + clamp(-dot(objectNormal.xy, normalize(ringC.xy)), 0., 1.) * .45;`,
    );
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uCoreGlow;\nvarying float vUnder;").replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n  totalEmissiveRadiance += uCoreGlow * vUnder * vUnder;",
    );
  };
  const geo = new THREE.TorusGeometry(RING.radius, RING.tube, low ? 24 : 48, low ? 96 : 200);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "intro:the-ring";
  mesh.raycast = () => {};
  return { mesh, mat, tube, glow, dispose: () => (geo.dispose(), mat.dispose()) };
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

    const detail = Object.fromEntries(buildReactorDetail(quality.name).map((p) => [p.name, p]));
    const ringGeo = detail.rings.geometry;
    const ringMat = surfaceMaterial(u, cu, ringFrag);
    const rings = add(new THREE.InstancedMesh(ringGeo, ringMat, RINGS.length), "reactor:rings");
    rings.frustumCulled = false;
    const spins = RINGS.map(() => 0);

    const pulse = { value: 0 };
    const cableGeo = cableGeometry(low ? 4 : 6);
    const cableMat = new THREE.ShaderMaterial({
      vertexShader: cableVert,
      fragmentShader: surfaceFrag(cableFrag),
      uniforms: { ...u, ...cu, uN: { value: CABLES.length }, uPulse: pulse },
    });
    add(new THREE.Mesh(cableGeo, cableMat), "reactor:cables");

    // The detail: panels on the core, junction boxes on the wall, clamps along the cables.
    const panelMat = surfaceMaterial(u, { ...cu, uFlow: flow }, panelFrag, { side: THREE.DoubleSide });
    add(new THREE.Mesh(detail.panels.geometry, panelMat), "reactor:panels");
    const junctionMat = surfaceMaterial(u, { ...cu, uN: { value: CABLES.length } }, junctionFrag);
    add(new THREE.Mesh(detail.junctions.geometry, junctionMat), "reactor:junctions");
    const clampMat = surfaceMaterial(u, cu, metalFrag);
    const clamps = add(new THREE.InstancedMesh(detail.clamps.geometry, clampMat, detail.clamps.instances!), "reactor:clamps");
    detail.clamps.matrices!.forEach((mx, i) => clamps.setMatrixAt(i, mx));
    clamps.frustumCulled = false;

    const rate = { value: 0 };
    const topC = { value: new THREE.Vector3() };
    const topR = { value: 1 };
    const flareGeo = flares(low ? 160 : 600);
    const flareMat = new THREE.ShaderMaterial({
      vertexShader: flareVert,
      fragmentShader: flareFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uLight: u.uLight, uTime: u.uTime, uRate: rate, uPR: pr, uTop: topC, uTopR: topR, uAxis: cu.uAxis,
                  uRingY: { value: new THREE.Vector4(...RINGS.map((r) => r.y)) },
                  uRingR: { value: new THREE.Vector4(...RINGS.map((r) => r.radius)) } },
    });
    const flarePts = add(new THREE.Points(flareGeo, flareMat), "reactor:sparks");
    flarePts.frustumCulled = false;

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
    const disposables = [cavernGeo, cavernMat, coreGeo, coreMat, metalGeo, metalMat, ringGeo, ringMat, cableGeo, cableMat, sparkGeo, sparkMat, env,
      detail.panels.geometry, panelMat, detail.junctions.geometry, junctionMat, detail.clamps.geometry, clampMat, clamps, flareGeo, flareMat];

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
        pulse.value += s.dt * pulseSpeed(p);
        rate.value = sparkRate(p, s.lift);
        const top = ringPose(s.lift);
        topC.value.set(...top.center);
        topR.value = top.radius;
        flarePts.visible = rate.value > 0 && s.light > 0;
        RINGS.forEach((r, i) => {
          spins[i] += s.dt * ringSpeed(p) * r.dir * (1 + i * 0.15);
          e.set(-Math.PI / 2 + r.tilt * Math.sin(spins[i] * 0.37), 0, spins[i]);
          m.compose(new THREE.Vector3(AX, r.y, AZ), q.setFromEuler(e), new THREE.Vector3(r.radius, r.radius, r.radius));
          rings.setMatrixAt(i, m);
        });
        rings.instanceMatrix.needsUpdate = true;
        ring.mesh.position.set(...top.center);
        ring.mesh.scale.setScalar(top.radius / RING.radius);
        ring.mesh.rotation.set(-Math.PI / 2, 0, s.time * 0.08 + spins[0] * 0.2);
        ring.tube.value = 1 - s.burst;
        ring.mat.envMapIntensity = 0.9 * s.ringLight;
        ring.mat.emissiveIntensity = (0.02 + 0.14 * p * p) * s.ringLight * (1 - s.burst);
        // Lit from the core below, fading as it lifts away (and gone as it bursts).
        ring.glow.value.copy(TEAL).lerp(WHITE, 0.5).multiplyScalar(0.2 * p * p * s.ringLight * (1 - s.burst) * (1 - 0.5 * s.lift));
        ring.mat.iridescenceThicknessRange[1] = 700 + 220 * Math.sin(s.time * 0.7);
        ring.mesh.visible = s.ringLight > 0 && s.burst < 0.999;
        // The rest of the reactor only while its light is up.
        for (const c of group.children) if (c !== ring.mesh && c !== flarePts) c.visible = s.light > 0;
        group.visible = s.light > 0 || ring.mesh.visible;
      },
      dispose() {
        rings.dispose();
        ring.dispose();
        disposables.forEach((d) => d.dispose());
      },
    };
  }, [gl, low, quality.name]);
  useEffect(() => () => handle.dispose(), [handle]);
  return handle;
}
