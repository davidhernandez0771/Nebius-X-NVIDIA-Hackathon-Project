// The forest's fireflies (fireflyPlan.ts plans them), one Points draw, every motion in the shader. Each is a real
// firefly, sized in metres (so it has depth: big near the camera, a spark far off): a small hot body, a glow round it
// and a soft halo. They wander (fireflyPlan.ts driftAt, mirrored below), flash (blinkAt, mirrored), circle their
// robot, or, the crack's, swirl into the crack as the camera comes (uSwirl) and then fall with it (uDrop) until the
// reactor takes over, drawn through the fall as they always were (the fall itself is unchanged). A few large soft
// ones hang near the camera's way. The lanterns also light the forest: `glows` carries their places and brightness
// to the place shaders (placeShaders.ts uGlowP). Additive, so the bloom picks them up. Under reduced motion they
// hold still and only blink.
import * as THREE from "three";
import { BLINK_EMBER, KIND, LANTERNS, blinkAt, driftAt, type Fireflies } from "./fireflyPlan";
import { CRACK, FOREST } from "./layout";
import { OUT } from "./placeShaders";

// fireflyPlan.ts driftAt and blinkAt, in GLSL (keep them in step).
const MIRROR = /* glsl */ `
vec3 driftAt(vec4 r, float t){
  float ph = r.y * 6.2832, s = r.z;
  return vec3(sin(t * (.11 + .09 * s) + ph) * 1.3 + sin(t * .05 + ph * 2.) * .9 + .05 * sin(t * (2.9 + 1.3 * s) + ph * 7.),
              sin(t * (.19 + .1 * s) + ph * 1.3) * .45 + .04 * sin(t * (3.7 + s) + ph * 11.),
              cos(t * (.09 + .08 * s) + ph) * 1.3 + cos(t * .04 + ph * 3.) * .9 + .05 * cos(t * (3.1 + .9 * s) + ph * 5.));
}
float flashAt(float p){ return smoothstep(0., .06, p) * (1. - smoothstep(.06, .32, p)); }
float blinkAt(vec4 r, float t){
  float ph = fract(t / (2.6 + 3.4 * r.x) + r.y * 7.31);
  float f = max(flashAt(ph), r.w > .6 ? .7 * flashAt(ph - .38) : 0.);
  return ${BLINK_EMBER.toFixed(3)} + (1. - ${BLINK_EMBER.toFixed(3)}) * f;
}`;

const vert = /* glsl */ `
attribute vec3 aCenter; attribute vec3 aColor; attribute float aKind; attribute vec4 aRand;
uniform float uTime, uPR, uPx, uLight, uDrop, uSwirl, uStill, uFloor;
uniform vec2 uCrack;
varying vec3 vColor; varying float vA; varying float vSoft; varying float vOld; varying float vBody;
${MIRROR}
void main(){
  float t = uTime * (1. - uStill);
  float ph = aRand.y * 6.2832, s = aRand.z;
  vec3 p = position;
  float lit = uLight;
  // The halo's width (m) and the body's share of it.
  float halo = .5 * (.75 + .5 * aRand.w);
  vBody = .14;
  vSoft = 0.;
  vOld = 0.;
  if (aKind < .5 || aKind > 3.5) {
    p += driftAt(aRand, t);
    // The lanterns: brighter, a wider halo.
    if (aKind > 3.5) { halo *= 1.7; vBody = .09; }
  } else if (aKind > 2.5) {
    // Out of focus, near the camera's way: a soft disc.
    p += driftAt(aRand, t) * .6;
    vSoft = 1.;
  } else if (aKind < 1.5) {
    // Round a fallen robot, both ways round, rising and sinking a little, with the same small jitter.
    float a = ph + t * (.18 + .25 * s) * (s > .5 ? 1. : -1.);
    float r = .8 + 1.1 * aRand.w;
    p = aCenter + vec3(cos(a) * r, .35 + 1.3 * fract(s * 7.3) + sin(t * .6 + ph) * .25, sin(a) * r);
    p += .05 * vec3(sin(t * 2.9 + ph * 7.), sin(t * 3.7 + ph * 11.), cos(t * 3.1 + ph * 5.));
  } else {
    // The crack's: swirling in toward the crack as the camera comes, sinking to its lip...
    vec2 rel = p.xz - uCrack;
    float a = atan(rel.y, rel.x) + (t * (.35 + .4 * s) + 2.) * uSwirl;
    float rr = length(rel) * mix(1., .3, uSwirl);
    vec3 sw = vec3(uCrack.x + cos(a) * rr, mix(p.y, uFloor - .2 - 1.2 * fract(s * 5.1), uSwirl * .7), uCrack.y + sin(a) * rr);
    // ...then a loose shell round the camera, below and round it, falling with it.
    float fa = ph + t * (.5 + .5 * s);
    float fr = .5 + .9 * aRand.w;
    vec3 fall = vec3(cameraPosition.x + cos(fa) * fr, cameraPosition.y - .8 - 4.5 * fract(s * 3.7) + sin(t * .9 + ph) * .4, cameraPosition.z + sin(fa) * fr);
    p = mix(sw, fall, smoothstep(.15, .85, uDrop));
    lit = max(uLight, uDrop);
    // Through the fall they are drawn as they always were.
    vOld = smoothstep(0., .15, uDrop);
  }
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  float d = max(.3, -mv.z);
  float oldBlink = .2 + .8 * pow(.5 + .5 * sin(uTime * (.5 + 2.4 * aRand.x) + ph * 3.), 4.);
  if (vSoft > .5) {
    gl_PointSize = clamp(14. * (.7 + .6 * aRand.w) * uPR * (6. / d), uPR, 90. * uPR);
    vA = oldBlink * lit * exp(-d * .03) * .22 * smoothstep(.6, 2.5, d);
    return;
  }
  // In metres on screen (uPx: pixels per metre at 1 m), never smaller than a spark.
  float now = clamp(halo * uPx / d, 2.5 * uPR, 140. * uPR);
  float old = clamp(2.4 * (.6 + .8 * aRand.w) * uPR * (6. / d), uPR, 12. * uPR);
  gl_PointSize = mix(now, old, vOld);
  // Far ones are only their spark: as the halo shrinks to a few pixels the body takes the whole sprite.
  vBody = mix(vBody, 1., 1. - smoothstep(4. * uPR, 14. * uPR, now));
  vA = mix(blinkAt(aRand, uTime), oldBlink, vOld) * lit * exp(-d * .025);
}`;

const frag = /* glsl */ `
varying vec3 vColor; varying float vA; varying float vSoft; varying float vOld; varying float vBody;
void main(){
  vec2 c = gl_PointCoord - .5;
  float r = length(c) * 2.;
  if (r > 1.) discard;
  vec3 col;
  if (vSoft > .5) col = vColor * smoothstep(1., .55, r);
  else {
    // A hot body (whiter than its colour), a glow round it and a soft halo, fading to nothing at the sprite's edge.
    float b = r / vBody;
    float body = exp(-b * b * 3.);
    float glow = exp(-b * b * .35) * .55;
    float halo = exp(-r * r * 4.5) * .22 * (1. - r);
    vec3 now = mix(vColor, vec3(1.), body * .55) * (body * 1.6 + glow) + vColor * halo;
    vec3 old = vColor * (exp(-r * r * 9.) + .3 * exp(-r * r * 2.5));
    col = mix(now, old, vOld);
  }
  gl_FragColor = vec4(col * vA, 1.);
  ${OUT}
}`;

export interface FirefliesState {
  time: number;
  /** The forest's light, and the fall's (only the crack's fireflies show by it). */
  light: number;
  drop: number;
  /** 0–1: the camera nearing the crack; the crack's fireflies swirl into it. */
  swirl: number;
  pr: number;
  /** Reduced motion: they hold still and only blink. */
  still: boolean;
}

export interface FirefliesHandle {
  points: THREE.Points;
  /** The lanterns' light for the place shaders: places (xyz, brightness in w) and colours, written by update. */
  glows: { position: THREE.Vector4[]; color: THREE.Vector3[] };
  update(s: FirefliesState): void;
  dispose(): void;
}

export function makeFireflies(plan: Fireflies): FirefliesHandle {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(plan.position, 3));
  g.setAttribute("aCenter", new THREE.BufferAttribute(plan.center, 3));
  g.setAttribute("aColor", new THREE.BufferAttribute(plan.color, 3));
  g.setAttribute("aKind", new THREE.BufferAttribute(plan.kind, 1));
  g.setAttribute("aRand", new THREE.BufferAttribute(plan.rand, 4));
  const uniforms = {
    uTime: { value: 0 },
    uPR: { value: 1 },
    uPx: { value: 600 },
    uLight: { value: 0 },
    uDrop: { value: 0 },
    uSwirl: { value: 0 },
    uStill: { value: 0 },
    uFloor: { value: FOREST.floor },
    uCrack: { value: new THREE.Vector2(...CRACK.center) },
  };
  const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  points.raycast = () => {};
  // Pixels per metre at 1 m from the camera, from the real projection: the fireflies are sized in metres.
  const buffer = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    uniforms.uPx.value = renderer.getDrawingBufferSize(buffer).y / (2 * Math.tan((fov * Math.PI) / 360));
  };
  const lanterns = [...Array(plan.count).keys()].filter((i) => plan.kind[i] === KIND.lantern).slice(0, LANTERNS);
  const glows = {
    position: Array.from({ length: LANTERNS }, () => new THREE.Vector4()),
    color: Array.from({ length: LANTERNS }, (_, k) => (lanterns[k] === undefined ? new THREE.Vector3() : new THREE.Vector3().fromArray(plan.color, lanterns[k] * 3))),
  };
  const rand = (i: number) => [plan.rand[i * 4], plan.rand[i * 4 + 1], plan.rand[i * 4 + 2], plan.rand[i * 4 + 3]] as const;
  return {
    points,
    glows,
    update(s) {
      uniforms.uTime.value = s.time;
      uniforms.uLight.value = s.light;
      uniforms.uDrop.value = s.drop;
      uniforms.uSwirl.value = s.swirl;
      uniforms.uPR.value = s.pr;
      uniforms.uStill.value = s.still ? 1 : 0;
      // The lanterns' light, where the shader draws them (still under reduced motion), only while the forest is lit.
      const t = s.still ? 0 : s.time;
      lanterns.forEach((i, k) => {
        const d = driftAt(rand(i), t);
        const w = s.light > 0 ? blinkAt(rand(i), s.time) * s.light : 0;
        glows.position[k].set(plan.position[i * 3] + d[0], plan.position[i * 3 + 1] + d[1], plan.position[i * 3 + 2] + d[2], w);
      });
    },
    dispose() {
      g.dispose();
      m.dispose();
    },
  };
}
