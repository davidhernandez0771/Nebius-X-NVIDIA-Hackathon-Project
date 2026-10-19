// The mask for the dive into the workshop (dive.ts): one full-screen quad over everything. The frame
// closes to the ground colour from the edges, a teal rim riding the iris, with the roof's particles
// streaking outward through the dark as you fall; it opens again from the centre inside the room.
// Driven by the scroll (the workshop's travel), so it is exactly as fast as the visitor. With reduced
// motion the camera cuts behind the veil instead, and this stays off.
import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { StationFrame } from "../../core/types";
import { cover } from "./dive";

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const frag = /* glsl */ `
uniform float uCover, uPhase, uAspect;
uniform vec3 uGround, uTeal, uLime;
varying vec2 vUv;
float h(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p);
  float maxR = length(vec2(uAspect, 1.0)) * 0.5 + 0.08;
  // The hole the visitor falls through: everything outside it is dark.
  float R = mix(maxR, 0.0, uCover);
  float dark = smoothstep(R - 0.01, R + 0.07, r);
  float rim = exp(-abs(r - R) * 60.0) * step(0.001, uCover) * step(uCover, 0.999);
  // Streaks: thin radial lanes, each a dash running outward at its own speed.
  float a = atan(p.y, p.x) / 6.2831853 + 0.5;
  float bins = 220.0;
  float b = floor(a * bins);
  float rnd = h(b);
  float within = fract(a * bins);
  float lane = step(0.74, rnd) * smoothstep(0.32, 0.08, abs(within - 0.5));
  float s = fract(r * 1.4 - uPhase * (0.5 + rnd) + rnd * 7.0);
  float streak = lane * smoothstep(0.0, 0.01, s) * smoothstep(0.04 + 0.06 * rnd, 0.01, s) * smoothstep(0.06, 0.5, r) * (0.35 + 0.65 * h(b + 7.0));
  vec3 sc = mix(uTeal, uLime, step(0.8, h(b + 3.0)));
  vec3 col = uGround * dark + sc * streak * dark * 0.7 + uTeal * rim * 1.4;
  float alpha = clamp(dark + rim + streak * dark * 0.7, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

export function Portal({ frame, reduced }: { frame: StationFrame; reduced: boolean }) {
  const size = useThree((s) => s.size);
  const mesh = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uCover: { value: 0 },
        uPhase: { value: 0 },
        uAspect: { value: 1 },
        uGround: { value: new THREE.Color("#04070a") },
        uTeal: { value: new THREE.Color("#19f5c2") },
        uLime: { value: new THREE.Color("#bfe85c") },
      },
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    q.frustumCulled = false;
    q.renderOrder = 1e6;
    q.raycast = () => {};
    q.name = "workshop:portal";
    q.visible = false;
    return q;
  }, []);

  useFrame(({ clock }) => {
    const t = frame.arrive;
    const c = reduced || t <= 0 || t >= 1 ? 0 : cover(t);
    mesh.visible = c > 0.001;
    if (!mesh.visible) return;
    const u = mesh.material.uniforms;
    u.uCover.value = c;
    // The streaks run with the fall (the scroll) and a little on their own.
    u.uPhase.value = t * 7 + clock.elapsedTime * 0.25;
    u.uAspect.value = size.width / Math.max(1, size.height);
  });

  return <primitive object={mesh} />;
}
