// Ultra only: the air in the room. A soft shaft of light under each of the two pendant lamps (over
// the bench and over the machine, where the bake puts the pools of light on the floor) and one down
// through the ceiling's opening onto the spiral. Additive, no depth write, no fog; they follow the
// lamps (power.ts). The dust in them is the journey's one dust (stations/intro), so the workshop
// keeps to two Points objects.
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
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

const WARM = new THREE.Color("#FFE9C8");
export function Haze() {
  const mats = useMemo(() => [] as THREE.ShaderMaterial[], []);
  const shafts = useMemo(
    () =>
      SHAFTS.map((s) => {
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
      }),
    [mats],
  );

  useEffect(
    () => () =>
      shafts.forEach((s) => {
        s.g.dispose();
        s.m.dispose();
      }),
    [shafts],
  );

  useFrame(() => {
    const level = power.level;
    for (const m of mats) m.uniforms.uStrength.value = m.userData.strength * level;
  });

  return (
    <group name="haze">
      {shafts.map((s, i) => (
        <mesh key={i} geometry={s.g} material={s.m} position={s.pos} raycast={() => null} renderOrder={2} />
      ))}
    </group>
  );
}
