// The robot's hologram mesh on the bench: the chosen robot (robotHolo.ts) drawn as teal light standing on a
// ring of light on the cartridge's top. Edges glow (fresnel), scanlines climb it, and it materializes
// from its base up behind a bright line each time the robot changes. One mesh, one draw call: the ring
// is merged into the robot's geometry and told apart by `aRing`. Additive, no lighting, no shadows.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HOLO_H } from "./layout";

const TEAL = new THREE.Color("#19f5c2");
const RING_R = 0.42;

const vert = /* glsl */ `
  attribute float aRing;
  uniform float uH;
  varying float vRing, vH, vY;
  varying vec3 vN, vView;
  varying vec2 vXZ;
  void main() {
    vRing = aRing;
    vH = position.y / uH;
    vXZ = position.xz;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vY = world.y;
    vec4 mv = viewMatrix * world;
    vN = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const frag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLevel, uReveal, uTime;
  varying float vRing, vH, vY;
  varying vec3 vN, vView;
  varying vec2 vXZ;
  void main() {
    float flicker = 0.92 + 0.08 * sin(uTime * 23.0) * sin(uTime * 7.3);
    float a;
    if (vRing > 0.5) {
      float r = length(vXZ) / ${RING_R.toFixed(3)};
      float line = exp(-pow((r - 0.92) / 0.035, 2.0));
      float pool = (1.0 - smoothstep(0.0, 0.95, r)) * 0.22;
      float pulse = 0.75 + 0.25 * sin(uTime * 2.4 - r * 6.0);
      a = (line * 0.9 + pool) * pulse;
    } else {
      if (vH > uReveal) discard;
      float facing = abs(dot(normalize(vN), normalize(vView)));
      float rim = pow(1.0 - facing, 2.2);
      float scan = 0.62 + 0.38 * step(0.5, fract(vY * 26.0 - uTime * 1.2));
      float edge = uReveal < 1.0 ? exp(-pow((vH - uReveal) / 0.025, 2.0)) * 1.6 : 0.0;
      a = (0.08 + 0.85 * rim) * scan + edge;
    }
    a *= uLevel * flicker;
    // Premultiplied, added: the light only ever brightens what is behind it.
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }
`;

export interface HoloRobot {
  mesh: THREE.Mesh;
  uniforms: { uLevel: { value: number }; uReveal: { value: number }; uTime: { value: number } };
  /** Stand a robot's geometry (robotHolo.ts) on the ring; null keeps only the ring. */
  setRobot(geo: THREE.BufferGeometry | null): void;
  dispose(): void;
}

function ringGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(RING_R, 48).rotateX(-Math.PI / 2);
  g.deleteAttribute("uv");
  return g;
}

/** Only position and normal, plus aRing (1 on the ring, 0 on the robot), so the two merge. */
function tagged(g: THREE.BufferGeometry, ring: number): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  g.setAttribute("aRing", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count).fill(ring), 1));
  return g;
}

export function makeHoloRobot(): HoloRobot {
  const uniforms = { uLevel: { value: 0 }, uReveal: { value: 0 }, uTime: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: { ...uniforms, uColor: { value: TEAL.clone() }, uH: { value: HOLO_H } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    toneMapped: false,
  });
  const ring = tagged(ringGeometry(), 1);
  const mesh = new THREE.Mesh(ring.clone(), material);
  mesh.raycast = () => {};
  mesh.renderOrder = 11;
  mesh.frustumCulled = false;
  return {
    mesh,
    uniforms,
    setRobot(geo) {
      const old = mesh.geometry;
      if (!geo) mesh.geometry = ring.clone();
      else {
        // mergeGeometries wants all indexed or none (the stand-ins and the Franka are indexed).
        const robot = tagged(geo.index ? geo.clone() : geo.toNonIndexed(), 0);
        const both = mergeGeometries(robot.index ? [robot, ring] : [robot, ring.toNonIndexed()]);
        robot.dispose();
        mesh.geometry = both ?? ring.clone();
      }
      old.dispose();
    },
    dispose() {
      mesh.geometry.dispose();
      ring.dispose();
      material.dispose();
    },
  };
}
