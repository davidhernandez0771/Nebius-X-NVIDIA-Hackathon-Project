// Ultra only: the air in the room. A soft shaft of light under each of the two pendant lamps (over
// the bench and over the machine, where the pools of light lie on the floor: lightPools.ts) and one down
// through the ceiling's opening onto the spiral. The shafts fade out in the air above the floor: run down
// through it, their rims cut the floor in dashed rings that flickered as the camera moved. Additive, no depth write, no fog; they follow the
// lamps (power.ts). The dust in them is the journey's one dust (stations/intro), so the workshop
// keeps to two Points objects.
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { FLOOR_Y, LAMPS } from "./lightPools";
import { power } from "./power";

export interface Shaft {
  /** Top centre (where the light comes from) and the floor. */
  top: THREE.Vector3;
  floorY: number;
  topR: number;
  bottomR: number;
  strength: number;
}

/** Where the shafts end, faded to nothing: well clear of the floor. */
const END = FLOOR_Y + 1.4;
/** The lamps over the pools in front of each desk, and the opening over the spiral (the same cones as before, cut short). */
export const SHAFTS: Shaft[] = [
  ...LAMPS.map((l) => ({ top: new THREE.Vector3(l.x, 11.2, l.z), floorY: END, topR: 0.5, bottomR: 3.64, strength: 0.075 })),
  { top: new THREE.Vector3(0, 14.2, 0), floorY: END, topR: 4.6, bottomR: 4.42, strength: 0.05 },
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

/** Exported for its test: the base of every pow() is held at 0 or above. */
export const shaftFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying float vDown;
varying float vFacing;
void main() {
  // Brightest near the lamp, fading to the floor; soft at the silhouette, so it reads as volume. The
  // base is clamped: at the rim the interpolated vDown runs a hair past 1, and pow() of a negative base
  // is undefined (NaN on D3D), which the bloom spread into the dashed rings round each shaft's foot.
  float a = uStrength * pow(max(1.0 - vDown, 0.0), 1.6) * smoothstep(0.1, 1.0, vFacing) * smoothstep(0.0, 0.08, vDown);
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
