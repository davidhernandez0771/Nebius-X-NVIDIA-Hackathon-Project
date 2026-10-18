import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import type { V3 } from "./sceneMath";

// The single procedural room used by the landing page and the entry scene.
// World units ~ metres. y is up. The floor top is y = 0.

type Shape = THREE.BufferGeometry;

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0): Shape =>
  new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r: number, h: number, x = 0, y = 0, z = 0, seg = 18): Shape =>
  new THREE.CylinderGeometry(r, r, h, seg).translate(x, y, z);
const cone = (r: number, h: number, x = 0, y = 0, z = 0): Shape =>
  new THREE.CylinderGeometry(r * 0.35, r, h, 18, 1, true).translate(x, y, z);
const sph = (r: number, x = 0, y = 0, z = 0): Shape =>
  new THREE.SphereGeometry(r, 14, 10).translate(x, y, z);

export type PartKind = "shell" | "furniture" | "item" | "lamp";

export interface PartDef {
  id: string;
  name: string;
  kind: PartKind;
  pos: V3;
  explode: V3;
  shapes: Shape[];
  /** relative point density (big flat planes get fewer) */
  density: number;
  glass?: boolean;
  item?: { clutter: V3; clutterRot: V3; sorted: V3; state: number };
}

// --- shell and furniture ----------------------------------------------------

const shell: PartDef[] = [
  {
    id: "floor", name: "FLOOR", kind: "shell", pos: [0, -0.08, 0], explode: [0, -1.2, 0],
    shapes: [box(4.6, 0.16, 4.6)], density: 0.75,
  },
  {
    id: "wallBack", name: "WALL.N", kind: "shell", pos: [0, 1.25, -2.24], explode: [0, 0.5, -1.5],
    shapes: [box(4.6, 2.5, 0.12)], density: 0.7, glass: true,
  },
  {
    id: "wallLeft", name: "WALL.W", kind: "shell", pos: [-2.24, 1.25, 0], explode: [-1.6, 0.5, 0],
    shapes: [box(0.12, 2.5, 4.6)], density: 0.7, glass: true,
  },
];

const furniture: PartDef[] = [
  {
    id: "rug", name: "RUG", kind: "furniture", pos: [0.2, 0.01, 0.6], explode: [0, -0.4, 0.2],
    shapes: [box(2.4, 0.02, 1.7)], density: 0.7,
  },
  {
    id: "sofa", name: "SOFA", kind: "furniture", pos: [1.25, 0, 0.7], explode: [1.5, 0.9, 0.9],
    shapes: [
      box(0.9, 0.24, 1.9, 0, 0.12, 0),
      box(0.9, 0.16, 1.9, 0, 0.32, 0),
      box(0.2, 0.6, 1.9, 0.35, 0.42, 0),
      box(0.9, 0.32, 0.2, 0, 0.3, 0.85),
      box(0.9, 0.32, 0.2, 0, 0.3, -0.85),
    ],
    density: 1,
  },
  {
    id: "shelf", name: "SHELF", kind: "furniture", pos: [-1.1, 0, -1.98], explode: [-0.4, 1.5, -0.5],
    shapes: [
      box(0.06, 1.78, 0.4, -0.65, 0.89, 0),
      box(0.06, 1.78, 0.4, 0.65, 0.89, 0),
      box(1.36, 0.05, 0.4, 0, 0.05, 0),
      box(1.36, 0.05, 0.4, 0, 0.6, 0),
      box(1.36, 0.05, 0.4, 0, 1.15, 0),
      box(1.36, 0.05, 0.4, 0, 1.7, 0),
    ],
    density: 1.4,
  },
  {
    id: "desk", name: "DESK", kind: "furniture", pos: [1.1, 0, -1.8], explode: [1.3, 0.9, -0.6],
    shapes: [
      box(1.5, 0.06, 0.7, 0, 0.75, 0),
      box(0.06, 0.72, 0.06, -0.68, 0.36, -0.28),
      box(0.06, 0.72, 0.06, 0.68, 0.36, -0.28),
      box(0.06, 0.72, 0.06, -0.68, 0.36, 0.28),
      box(0.06, 0.72, 0.06, 0.68, 0.36, 0.28),
    ],
    density: 1.2,
  },
  {
    id: "plant", name: "PLANT", kind: "furniture", pos: [-1.8, 0, 1.6], explode: [-1.3, 0.5, 1.0],
    shapes: [cyl(0.2, 0.34, 0, 0.17, 0), sph(0.3, 0, 0.62, 0), sph(0.2, 0.14, 0.92, 0.05)],
    density: 1.6,
  },
];

const lamp: PartDef = {
  id: "lamp", name: "LAMP", kind: "lamp", pos: [1.62, 0.78, -1.8], explode: [0.9, 1.6, 0.4],
  shapes: [cyl(0.11, 0.03, 0, 0.015, 0), cyl(0.018, 0.48, 0, 0.27, 0, 8), cone(0.17, 0.2, 0, 0.56, 0)],
  density: 3,
};

// --- items ------------------------------------------------------------------
// clutter = where they sit before organizing, sorted = the slot on the shelf.
const mk = (
  id: string, name: string, shape: Shape, clutter: V3, clutterRot: V3, sorted: V3, state = 0,
): PartDef => ({
  id, name, kind: "item", pos: clutter, explode: [0, 0, 0], shapes: [shape], density: 5,
  item: { clutter, clutterRot, sorted, state },
});

const items: PartDef[] = [
  mk("mug", "MUG", cyl(0.07, 0.1, 0, 0, 0, 14), [0.72, 0.83, -1.7], [0, 0, 0], [-0.95, 0.675, -1.98]),
  mk("book", "BOOK", box(0.28, 0.06, 0.2), [0.2, 0.05, 0.9], [0, 0.5, 0], [-1.5, 0.105, -1.98]),
  mk("box", "BOX", box(0.3, 0.2, 0.22), [-0.5, 0.12, 1.5], [0, -0.4, 0], [-0.95, 0.175, -1.98]),
  mk("vase", "VASE", cyl(0.08, 0.22, 0, 0, 0, 14), [-1.25, 0.13, 0.2], [0, 0, 0], [-1.4, 0.735, -1.98]),
  mk("frame", "FRAME", box(0.3, 0.22, 0.03), [1.15, 0.52, 1.05], [0, 0.4, 0.35], [-1.4, 1.285, -1.98]),
  mk("charger", "CHARGER", box(0.1, 0.05, 0.1), [0.4, 0.045, -0.3], [0, 0.8, 0], [-0.85, 1.2, -1.98]),
  mk("ball", "BALL", sph(0.09), [-0.3, 0.11, 0.35], [0, 0, 0], [-0.6, 0.715, -1.98]),
  mk("camera", "CAMERA", box(0.16, 0.1, 0.08), [1.25, 0.47, 0.25], [0, -0.6, 0], [-0.62, 0.125, -1.98]),
];

export const PART_DEFS: PartDef[] = [...shell, ...furniture, lamp, ...items];

// --- geometry, points, materials --------------------------------------------

export interface BuiltPart {
  def: PartDef;
  geometry: THREE.BufferGeometry;
  edges: THREE.EdgesGeometry;
  points: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  edgeMaterial: THREE.LineBasicMaterial;
  edgeBase: number;
  emissiveBase: THREE.Color;
}

function surfaceArea(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute("position");
  const idx = g.getIndex();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let area = 0;
  const tri = idx ? idx.count / 3 : pos.count / 3;
  for (let i = 0; i < tri; i++) {
    const [ia, ib, ic] = idx
      ? [idx.getX(i * 3), idx.getX(i * 3 + 1), idx.getX(i * 3 + 2)]
      : [i * 3, i * 3 + 1, i * 3 + 2];
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return area;
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE = {
  floor: "#14100e",
  wall: "#20302f",
  furniture: "#40332b",
  plant: "#24443c",
  item: "#5a3b1c",
  lamp: "#7a5a2a",
};

/**
 * @param density points per square unit (before each part's own multiplier)
 */
export function buildRoom(density: number): BuiltPart[] {
  return PART_DEFS.map((def, n) => {
    const geometry = mergeGeometries(def.shapes, false)!;
    geometry.computeBoundingSphere();
    const edges = new THREE.EdgesGeometry(geometry, 28);

    // surface-sampled point cloud, deterministic per part
    const rand = mulberry(1000 + n * 97);
    const count = Math.max(60, Math.round(surfaceArea(geometry) * density * def.density));
    const sampler = new MeshSurfaceSampler(new THREE.Mesh(geometry));
    // setRandomGenerator exists at runtime but is missing from these typings
    (sampler as unknown as { setRandomGenerator(f: () => number): void }).setRandomGenerator(rand);
    sampler.build();
    const p = new Float32Array(count * 3);
    const r = new Float32Array(count);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      sampler.sample(v);
      p.set([v.x, v.y, v.z], i * 3);
      r[i] = rand();
    }
    const points = new THREE.BufferGeometry();
    points.setAttribute("position", new THREE.BufferAttribute(p, 3));
    points.setAttribute("aRand", new THREE.BufferAttribute(r, 1));
    points.computeBoundingSphere();

    const isItem = def.kind === "item" || def.kind === "lamp";
    const color =
      def.kind === "lamp" ? PALETTE.lamp : isItem ? PALETTE.item : def.glass ? PALETTE.wall :
      def.id === "floor" ? PALETTE.floor : def.id === "plant" ? PALETTE.plant : PALETTE.furniture;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: def.glass ? 0.15 : 0.55,
      metalness: def.glass ? 0.4 : 0.15,
      transparent: def.glass || def.kind === "lamp",
      opacity: def.glass ? 0.42 : 1,
      depthWrite: !def.glass,
      side: def.glass ? THREE.DoubleSide : THREE.FrontSide,
      emissive: new THREE.Color(isItem ? "#FF9A2E" : "#000000"),
      emissiveIntensity: isItem ? 0.18 : 0,
    });
    const edgeBase = isItem ? 0.55 : def.glass ? 0.5 : 0.26;
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: isItem ? "#FF9A2E" : "#35F0D0",
      transparent: true,
      opacity: edgeBase,
      depthWrite: false,
    });
    return {
      def, geometry, edges, points, material, edgeMaterial, edgeBase,
      emissiveBase: material.emissive.clone(),
    };
  });
}

/** Adds the sweep clip (and an edge glow) to a stock material. */
export function patchSweep(
  mat: THREE.Material,
  sweep: { value: number },
  glow: boolean,
) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSweep = sweep;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vWY;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vWY;\nuniform float uSweep;")
      .replace("void main() {", "void main() {\n if (vWY > uSweep) discard;");
    if (glow) {
      sh.fragmentShader = sh.fragmentShader.replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\n gl_FragColor.rgb += vec3(0.21, 0.94, 0.82) * smoothstep(0.14, 0.0, uSweep - vWY) * 0.85;",
      );
    }
  };
  mat.customProgramCacheKey = () => (glow ? "sweep-glow" : "sweep");
}

export const POINTS_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uScale;
  uniform float uSweep;
  attribute float aRand;
  varying float vAlpha;
  varying float vBand;
  varying float vRand;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float n = sin(uTime * 1.3 + aRand * 40.0);
    wp.xyz += normalize(vec3(sin(aRand * 91.0), cos(aRand * 57.0), sin(aRand * 33.0))) * 0.014 * n;
    float d = uSweep - wp.y;
    vAlpha = 1.0 - smoothstep(-0.02, 0.10, d);
    vBand = exp(-abs(d) * 12.0);
    vRand = aRand;
    vec4 mv = viewMatrix * wp;
    gl_PointSize = uSize * uScale * (1.0 + vBand * 0.9) * (0.6 + aRand * 0.8) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export const POINTS_FRAG = /* glsl */ `
  uniform vec3 uWarm;
  uniform vec3 uTeal;
  uniform vec3 uAmber;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vBand;
  varying float vRand;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.1, r);
    vec3 col = mix(uWarm, uAmber, step(0.86, vRand) * 0.85);
    col = mix(col, uTeal, clamp(vBand * 1.5, 0.0, 1.0));
    float alpha = a * vAlpha * uOpacity * (0.5 + vBand * 0.7);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;
