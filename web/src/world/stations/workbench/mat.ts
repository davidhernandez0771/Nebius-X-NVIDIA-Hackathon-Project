// The bench's cutting mat, live, over the baked one (whose atlas still holds the shadows of the old
// bench parts): dark, with a fine grid and a heavier one every half metre, as in the lead's render
// docs/design/blender/C-workbench-v1.png. A pool of light stands on the turntable, inside teal corner
// brackets, and the blank under the pointer gets its own brackets and a softer pool. The turntable's
// top is in the same mesh (its baked top holds an old shadow too): dark spun metal, fine grooves, a
// teal rim. One draw call, unlit like the room round it (its colour follows the lamps, power.ts),
// drawn in the room view too.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { benchPoint, MAT_TOP, TURNTABLE_LOCAL, TURNTABLE_TOP } from "./layout";

/** bx_B_Mat: 8.2 × 3.9 m, in the bench's own frame (x along its front, z toward the front edge). */
export const MAT_W = 8.2;
export const MAT_D = 3.9;
/** Just above the baked mat, so it wins the depth test without floating. */
const LIFT = 0.004;

/** A blank's footprint lying on the mat at BLANK_SCALE, half width and half length, and a margin for the brackets. */
export interface MatFocus {
  x: number;
  z: number;
  turn: number;
  halfW: number;
  halfL: number;
}

const vert = /* glsl */ `
varying vec2 vMat;
varying float vKind;
`;

const frag = /* glsl */ `
varying vec2 vMat;
varying float vKind;
uniform vec4 uTable;   // turntable x, z, ring radius, its pool's strength
uniform vec4 uHover;   // hovered blank x, z, turn, how lit (0..1)
uniform vec2 uHoverHalf;
uniform float uTime;

float gridLine(vec2 p, float step, float halfW) {
  vec2 g = abs(fract(p / step + 0.5) - 0.5) * step;
  vec2 w = fwidth(p);
  vec2 a = 1.0 - smoothstep(vec2(halfW) - w, vec2(halfW) + w, g);
  return max(a.x, a.y);
}

// Corner brackets round a box (half extents h) at the origin of q: arms of length arm, lines halfW wide.
float brackets(vec2 q, vec2 h, float arm, float halfW) {
  vec2 a = abs(q);
  vec2 w = fwidth(q);
  float onX = 1.0 - smoothstep(halfW - w.y, halfW + w.y, abs(a.y - h.y));
  float onY = 1.0 - smoothstep(halfW - w.x, halfW + w.x, abs(a.x - h.x));
  float inX = step(h.x - arm, a.x) * step(a.x, h.x + halfW);
  float inY = step(h.y - arm, a.y) * step(a.y, h.y + halfW);
  return max(onX * inX, onY * inY);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

/** The mat's own points (the bench's frame, metres) and which part each vertex is (0 the mat, 1 the turntable's top). */
function tag(g: THREE.BufferGeometry, kind: number): THREE.BufferGeometry {
  const pos = g.getAttribute("position");
  const local = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) local.set([pos.getX(i), pos.getZ(i)], i * 2);
  g.setAttribute("aMat", new THREE.BufferAttribute(local, 2));
  g.setAttribute("aKind", new THREE.BufferAttribute(new Float32Array(pos.count).fill(kind), 1));
  return g;
}

export function makeMat() {
  const mat = tag(new THREE.PlaneGeometry(MAT_W, MAT_D, 1, 1).rotateX(-Math.PI / 2).toNonIndexed(), 0);
  // The turntable's top, a hair over its baked one (its height relative to the mat's).
  const disc = new THREE.CircleGeometry(TURNTABLE_LOCAL.r - 0.012, 72).rotateX(-Math.PI / 2).translate(TURNTABLE_LOCAL.x, TURNTABLE_TOP + 0.004 - (MAT_TOP + LIFT), TURNTABLE_LOCAL.z);
  const top = tag(disc.toNonIndexed(), 1);
  const geometry = mergeGeometries([mat, top])!;
  disc.dispose();
  mat.dispose();
  top.dispose();

  const uniforms = {
    uTable: { value: new THREE.Vector4(TURNTABLE_LOCAL.x, TURNTABLE_LOCAL.z, TURNTABLE_LOCAL.r, 1) },
    uHover: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHoverHalf: { value: new THREE.Vector2(0.4, 0.42) },
    uTime: { value: 0 },
  };
  const material = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec2 aMat;\nattribute float aKind;${vert}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vMat = aMat;\n  vKind = aKind;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>${frag}`).replace(
      "#include <map_fragment>",
      /* glsl */ `#include <map_fragment>
  vec2 p = vMat;
  // The mat: near-black rubber with a faint grain, lit by the lamp over the bench (brighter round the turntable).
  float grain = hash(floor(p * 140.0)) * 0.018;
  float lamp = 1.0 - 0.45 * smoothstep(0.6, 4.6, length((p - uTable.xy) * vec2(0.8, 1.25)));
  vec3 col = vec3(0.036, 0.043, 0.047) * lamp + grain;
  // The grid: every 10 cm, heavier every 50 cm, fading with distance from the light.
  float fine = gridLine(p, 0.1, 0.0035);
  float major = gridLine(p, 0.5, 0.006);
  col += vec3(0.16, 0.19, 0.2) * (fine * 0.16 + major * 0.42) * lamp;
  // A border inset round the edge, like a printed cutting mat.
  vec2 e = vec2(${(MAT_W / 2).toFixed(2)}, ${(MAT_D / 2).toFixed(2)}) - abs(p);
  float border = 1.0 - smoothstep(0.0, fwidth(e.x) + fwidth(e.y), abs(min(e.x, e.y) - 0.12) - 0.006);
  col += vec3(0.2, 0.24, 0.25) * border * 0.6;
  // The turntable's pool of light and its brackets.
  float r = length(p - uTable.xy);
  col += vec3(0.42, 0.45, 0.44) * uTable.w * exp(-r * r / (uTable.z * uTable.z * 1.6)) * 0.55;
  float tb = brackets(p - uTable.xy, vec2(uTable.z + 0.16), 0.32, 0.012);
  col += vec3(0.10, 0.96, 0.76) * tb * (0.55 + 0.45 * uTable.w);
  // The blank under the pointer: a softer pool, brackets round its footprint (turned as it lies).
  if (uHover.w > 0.001) {
    vec2 d = p - uHover.xy;
    float c = cos(uHover.z), s = sin(uHover.z);
    vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    col += vec3(0.32, 0.35, 0.34) * uHover.w * exp(-dot(q, q) / 0.32) * 0.5;
    float hb = brackets(q, uHoverHalf + 0.07, 0.13, 0.009);
    col += vec3(0.10, 0.96, 0.76) * hb * uHover.w;
  }
  // The turntable's top: spun dark metal, fine grooves, a brushed highlight across it, a teal rim, and the pool.
  if (vKind > 0.5) {
    vec2 t = p - uTable.xy;
    float tr = length(t);
    float spun = 0.5 + 0.5 * sin(tr * 420.0);
    float sheen = pow(abs(t.x / max(tr, 1e-4)), 6.0) * 0.06;
    col = vec3(0.07, 0.075, 0.078) + vec3(spun * 0.012) + vec3(sheen);
    col += vec3(0.42, 0.45, 0.44) * uTable.w * exp(-tr * tr / 0.5) * 0.4;
    float rim = smoothstep(uTable.z - 0.06, uTable.z - 0.03, tr);
    col = mix(col, vec3(0.10, 0.96, 0.76) * (0.45 + 0.4 * uTable.w), rim * 0.8);
  }
  diffuseColor.rgb *= col;`,
    );
  };
  material.customProgramCacheKey = () => "bench-mat";

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "bench:mat";
  mesh.raycast = () => {};
  mesh.position.copy(benchPoint(0, MAT_TOP + LIFT, 0));
  // The bench's turn (benchPoint's frame): the plane's own x and z are the bench's.
  mesh.quaternion.copy(benchQuaternion());
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { mesh, material, uniforms, release: () => (geometry.dispose(), material.dispose()) };
}

/** The bench's turn as a quaternion: maps its own frame (x along the front, z forward) to the anchor's. */
export function benchQuaternion(out = new THREE.Quaternion()): THREE.Quaternion {
  const x = benchPoint(1, 0, 0);
  return out.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-x.z, x.x));
}

/** Point the mat's hover brackets at a blank (its place in the bench's frame), lit by `level` (0: none). */
export function setMatHover(u: ReturnType<typeof makeMat>["uniforms"], f: MatFocus | null, level: number): void {
  if (f) {
    u.uHover.value.set(f.x, f.z, f.turn, level);
    u.uHoverHalf.value.set(f.halfW, f.halfL);
  } else u.uHover.value.w = level;
}
