// The pools of light under the two pendant lamps (over the bench and over the machine): a soft warm disc on
// the floor on every tier, following the lamps (power.ts). The bake has faint pools of its own; these are
// what reads as the lamps' light. Analytic (no texture): a smooth falloff to zero well inside the quad, a
// little dither against banding, additive, no depth write, and pulled toward the camera (polygon offset) as
// well as lifted, so it never fights the floor's depth and nothing flickers as the camera moves.
import * as THREE from "three";
import { BENCH_PIVOT, MACHINE_PIVOT } from "./layout";

/** The workshop floor's top (the arm stands on it). */
export const FLOOR_Y = -0.22;
/** How far above the floor the pools lie: with the polygon offset, clear of its depth. */
const LIFT = 0.02;

/** Where the two pendant lamps hang (Haze.tsx's shafts and Pendants.tsx), over the floor in front of each desk. */
export const LAMPS: readonly { x: number; z: number }[] = [
  { x: BENCH_PIVOT.position[0] + 0.6, z: BENCH_PIVOT.position[2] + 1.8 },
  { x: MACHINE_PIVOT.position[0] - 0.6, z: MACHINE_PIVOT.position[2] + 1.8 },
];

export const POOLS: readonly { x: number; z: number; radius: number }[] = LAMPS.map((l) => ({ ...l, radius: 4.4 }));

/** Both pools as one mesh: a flat quad each, uv -1..1 across it. */
export function poolGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  POOLS.forEach((p, k) => {
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      pos.push(p.x + u * p.radius, FLOOR_Y + LIFT, p.z + v * p.radius);
      uv.push(u, v);
    }
    // Counter-clockwise seen from above: the quad faces up.
    const o = k * 4;
    index.push(o, o + 2, o + 1, o, o + 3, o + 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  // A soft centre falling away, reaching zero well inside the quad's edge: no rim to see.
  float a = uStrength * exp(-2.6 * r * r) * (1.0 - smoothstep(0.55, 0.95, r));
  // Dither by a pixel's worth, so the long shallow gradient doesn't band.
  a += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0 * step(0.001, a);
  gl_FragColor = vec4(uColor * max(a, 0.0), 1.0);
}`;

export const POOL_COLOR = new THREE.Color("#FFE3B8");
/** The pools' brightness with the lamps full on. */
export const POOL_STRENGTH = 0.16;

export function poolMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: { uColor: { value: POOL_COLOR.clone() }, uStrength: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
}
