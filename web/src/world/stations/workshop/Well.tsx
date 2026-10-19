// What fills the skylight from above, instead of the room seen through it: a well of light. Teal
// rings sink toward a dark centre (a tunnel, so the opening reads as deep), and they flow inward as
// the visitor scrolls down, so the descent pulls at it before the dive goes through
// (dive.ts, Portal.tsx). One additive disc in the opening, drawn only while the camera is above the
// roof (AboveRoof). With reduced motion the rings hold still.
import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useWorld } from "../../core/WorldContext";
import { SKYLIGHT } from "../intro/layout";

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
uniform float uFlow;
uniform vec3 uTeal;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // Depth down the tunnel: the rings crowd toward the centre, as if they went far down.
  float depth = 2.4 / (r + 0.25);
  float d = abs(fract(depth - uFlow) - 0.5);
  float w = fwidth(depth) * 1.2 + 0.02;
  float ring = 1.0 - smoothstep(0.0, w, d);
  // Bright near the rim, fading into the dark centre.
  float fade = smoothstep(0.04, 0.5, r) * smoothstep(1.0, 0.88, r);
  // A faint glow along the wall of the well.
  float wall = smoothstep(0.7, 1.0, r) * 0.06;
  vec3 col = uTeal * (ring * fade * 0.5 + wall);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function Well({ reduced }: { reduced: boolean }) {
  const { store } = useWorld();
  const mesh = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      uniforms: { uFlow: { value: 0 }, uTeal: { value: new THREE.Color("#19f5c2") } },
    });
    const d = new THREE.Mesh(new THREE.CircleGeometry(SKYLIGHT.radius, 64), m);
    d.rotation.x = -Math.PI / 2;
    d.position.set(SKYLIGHT.center[0], SKYLIGHT.center[1] - 0.05, SKYLIGHT.center[2]);
    d.raycast = () => {};
    d.name = "workshop:well";
    return d;
  }, []);

  useFrame(({ clock }) => {
    if (reduced) return;
    // The scroll pulls the rings in (a ring per ~half a screen), the clock keeps them drifting.
    const vh = Math.max(1, window.innerHeight);
    mesh.material.uniforms.uFlow.value = (store.shownY / vh) * 2 + clock.elapsedTime * 0.12;
  });

  return <primitive object={mesh} />;
}
