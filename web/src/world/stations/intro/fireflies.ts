// The forest's fireflies (fireflyPlan.ts plans them), one Points draw, every motion in the shader: drifting ones on
// slow curving paths, robot ones circling their robot, crack ones swirling into the crack as the camera comes
// (uSwirl) and then falling with it (uDrop) until the reactor takes over, a few large soft ones near the camera's
// way. Each blinks on its own rhythm; additive, so the bloom picks them up. Under reduced motion they hold still
// and only blink.
import * as THREE from "three";
import type { Fireflies } from "./fireflyPlan";
import { CRACK, FOREST } from "./layout";
import { OUT } from "./placeShaders";

const vert = /* glsl */ `
attribute vec3 aCenter; attribute vec3 aColor; attribute float aKind; attribute vec4 aRand;
uniform float uTime, uPR, uLight, uDrop, uSwirl, uStill, uFloor;
uniform vec2 uCrack;
varying vec3 vColor; varying float vA; varying float vSoft;
void main(){
  float t = uTime * (1. - uStill);
  float ph = aRand.y * 6.2832, s = aRand.z;
  vec3 p = position;
  float lit = uLight;
  float size = 2.4 * (.6 + .8 * aRand.w);
  vSoft = 0.;
  if (aKind < .5 || aKind > 2.5) {
    // Slow curving paths: two slow loops on top of each other, never the same twice.
    p += vec3(sin(t * (.11 + .09 * s) + ph) * 1.6 + sin(t * .05 + ph * 2.) * 1.1,
              sin(t * (.19 + .1 * s) + ph * 1.3) * .5,
              cos(t * (.09 + .08 * s) + ph) * 1.6 + cos(t * .04 + ph * 3.) * 1.1);
    if (aKind > 2.5) { size = 14. * (.7 + .6 * aRand.w); vSoft = 1.; }
  } else if (aKind < 1.5) {
    // Round a fallen robot, both ways round, rising and sinking a little.
    float a = ph + t * (.22 + .3 * s) * (s > .5 ? 1. : -1.);
    float r = .8 + 1.1 * aRand.w;
    p = aCenter + vec3(cos(a) * r, .35 + 1.3 * fract(s * 7.3) + sin(t * .6 + ph) * .25, sin(a) * r);
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
  }
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = clamp(size * uPR * (6. / max(.4, d)), 1. * uPR, (vSoft > .5 ? 90. : 12.) * uPR);
  // Each its own rhythm: mostly a low glow, now and then a soft flash.
  float blink = .2 + .8 * pow(.5 + .5 * sin(uTime * (.5 + 2.4 * aRand.x) + ph * 3.), 4.);
  vA = blink * lit * exp(-d * .03) * (vSoft > .5 ? .22 * smoothstep(.6, 2.5, d) : 1.);
}`;

const frag = /* glsl */ `
varying vec3 vColor; varying float vA; varying float vSoft;
void main(){
  vec2 c = gl_PointCoord - .5;
  float r = length(c) * 2.;
  if (r > 1.) discard;
  // A bright core in a soft halo; the large ones a soft, even disc (out of focus).
  float a = vSoft > .5 ? smoothstep(1., .55, r) : exp(-r * r * 9.) + .3 * exp(-r * r * 2.5);
  gl_FragColor = vec4(vColor * a * vA, 1.);
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
  return {
    points,
    update(s) {
      uniforms.uTime.value = s.time;
      uniforms.uLight.value = s.light;
      uniforms.uDrop.value = s.drop;
      uniforms.uSwirl.value = s.swirl;
      uniforms.uPR.value = s.pr;
      uniforms.uStill.value = s.still ? 1 : 0;
    },
    dispose() {
      g.dispose();
      m.dispose();
    },
  };
}
