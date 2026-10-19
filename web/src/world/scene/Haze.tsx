// Ultra only: the air in the room. A soft shaft of light under each of the two pendant lamps (over
// the bench and over the machine, where the bake puts the pools of light on the floor) and one down
// through the ceiling's opening onto the spiral, plus dust drifting in them. Additive, no depth
// write, no fog; everything follows the lamps (power.ts). The dust moves in the vertex shader from
// one time uniform, so its idle loop costs a uniform per frame. With reduced motion it stays still.
import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BENCH_PIVOT, MACHINE_PIVOT } from "./layout";
import { power } from "./power";

export interface Shaft {
  /** Top centre (where the light comes from) and the floor. */
  top: THREE.Vector3;
  floorY: number;
  topR: number;
  bottomR: number;
  strength: number;
}

const FLOOR = -0.6;
/** Pools on the floor in front of each desk (matched against W-baked-preview), lamps above them. */
export const SHAFTS: Shaft[] = [
  { top: new THREE.Vector3(BENCH_PIVOT.position[0] + 0.6, 11.2, BENCH_PIVOT.position[2] + 1.8), floorY: FLOOR, topR: 0.5, bottomR: 4.2, strength: 0.075 },
  { top: new THREE.Vector3(MACHINE_PIVOT.position[0] - 0.6, 11.2, MACHINE_PIVOT.position[2] + 1.8), floorY: FLOOR, topR: 0.5, bottomR: 4.2, strength: 0.075 },
  { top: new THREE.Vector3(0, 14.2, 0), floorY: FLOOR, topR: 4.6, bottomR: 4.4, strength: 0.05 },
];

const shaftVert = /* glsl */ `
varying float vDown;
varying float vFacing;
void main() {
  vDown = 1.0 - uv.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 v = normalize(cameraPosition - wp.xyz);
  vFacing = abs(dot(n, v));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const shaftFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying float vDown;
varying float vFacing;
void main() {
  // Brightest near the lamp, fading to the floor; soft at the silhouette, so it reads as volume.
  float a = uStrength * pow(1.0 - vDown, 1.6) * smoothstep(0.1, 1.0, vFacing) * smoothstep(0.0, 0.08, vDown);
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const dustVert = /* glsl */ `
uniform float uTime;
uniform float uSize;
attribute float aSeed;
varying float vGlow;
void main() {
  vec3 p = position;
  // A slow drift and a little curl, different for every mote.
  p.y += mod(uTime * (0.05 + 0.05 * aSeed) + aSeed * 7.0, 1.0) * 0.6 - 0.3;
  p.x += sin(uTime * 0.21 + aSeed * 31.0) * 0.18;
  p.z += cos(uTime * 0.17 + aSeed * 17.0) * 0.18;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize / -mv.z, 6.0 * uSize / 34.0);
  // Motes right in front of the lens would be blurry blobs: fade them out.
  vGlow = (0.35 + 0.65 * fract(aSeed * 13.7)) * smoothstep(2.0, 6.0, -mv.z);
}`;

const dustFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
varying float vGlow;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.25, 0.0, dot(c, c)) * vGlow * uLevel;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const WARM = new THREE.Color("#FFE9C8");
const DUST_PER_SHAFT = 380;

/** Repeatable motes inside a shaft's cone. */
export function dustPoints(s: Shaft, n: number, seed: number): { positions: Float32Array; seeds: Float32Array } {
  const positions = new Float32Array(n * 3);
  const seeds = new Float32Array(n);
  let h = seed * 9973 + 17;
  const rnd = () => {
    h = (h * 16807) % 2147483647;
    return h / 2147483647;
  };
  for (let i = 0; i < n; i++) {
    const down = Math.pow(rnd(), 0.8);
    const y = s.top.y + (s.floorY - s.top.y) * down;
    const r = (s.topR + (s.bottomR - s.topR) * down) * Math.sqrt(rnd()) * 0.92;
    const a = rnd() * Math.PI * 2;
    positions.set([s.top.x + r * Math.cos(a), y, s.top.z + r * Math.sin(a)], i * 3);
    seeds[i] = rnd();
  }
  return { positions, seeds };
}

/** `drift`: whether the dust moves this frame (ultra, motion allowed, the room in view). */
export function Haze({ drift }: { drift: () => boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const dpr = useThree((s) => s.viewport.dpr);
  const { shafts, dust, dustMat, mats } = useMemo(() => {
    const mats: THREE.ShaderMaterial[] = [];
    const shafts = SHAFTS.map((s) => {
      const h = s.top.y - s.floorY;
      const g = new THREE.CylinderGeometry(s.topR, s.bottomR, h, 40, 1, true);
      const m = new THREE.ShaderMaterial({
        vertexShader: shaftVert,
        fragmentShader: shaftFrag,
        uniforms: { uColor: { value: WARM }, uStrength: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      m.userData.strength = s.strength;
      mats.push(m);
      return { g, m, pos: new THREE.Vector3(s.top.x, s.floorY + h / 2, s.top.z) };
    });
    const parts = SHAFTS.slice(0, 2).map((s, i) => dustPoints(s, DUST_PER_SHAFT, i + 1));
    const positions = new Float32Array(parts.reduce((n, p) => n + p.positions.length, 0));
    const seeds = new Float32Array(parts.reduce((n, p) => n + p.seeds.length, 0));
    let o = 0;
    let k = 0;
    for (const p of parts) {
      positions.set(p.positions, o);
      seeds.set(p.seeds, k);
      o += p.positions.length;
      k += p.seeds.length;
    }
    const dust = new THREE.BufferGeometry();
    dust.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    dust.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const dustMat = new THREE.ShaderMaterial({
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      uniforms: { uTime: { value: 0 }, uSize: { value: 34 }, uColor: { value: WARM }, uLevel: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { shafts, dust, dustMat, mats };
  }, []);

  useEffect(
    () => () => {
      shafts.forEach((s) => {
        s.g.dispose();
        s.m.dispose();
      });
      dust.dispose();
      dustMat.dispose();
    },
    [shafts, dust, dustMat],
  );

  useFrame(({ clock }) => {
    const level = power.level;
    for (const m of mats) m.uniforms.uStrength.value = m.userData.strength * level;
    dustMat.uniforms.uLevel.value = 0.55 * level;
    dustMat.uniforms.uSize.value = 34 * dpr;
    if (drift()) {
      dustMat.uniforms.uTime.value = clock.elapsedTime;
      invalidate();
    }
  });

  return (
    <group name="haze">
      {shafts.map((s, i) => (
        <mesh key={i} geometry={s.g} material={s.m} position={s.pos} raycast={() => null} renderOrder={2} />
      ))}
      <points geometry={dust} material={dustMat} raycast={() => null} renderOrder={3} frustumCulled={false} />
    </group>
  );
}
