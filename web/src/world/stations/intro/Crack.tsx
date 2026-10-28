// The crack in the forest floor, behind one component so a Blender model can fill it (crackSlot.ts). The procedural
// part: the crack's lens outline (forestPlan.ts crackHalfWidth) carried straight down through the rock as a fissure,
// dark, with a cold glow from the reactor far below. If a binary glTF sits at CRACK_SLOT.url it goes in front of the
// fissure (which stays, closing any gap behind the floor's cut): placed in the slot's frame, drawn with the same rock
// shader. From the forest the crack fades with the forest's light and only the model's top is drawn; during the fall
// (storyPlan.ts dropLight) its walls are lit from below by the reactor's glow and all of it is drawn.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CRACK_SLOT, CRACK_YAW, crackToWorld, depthOrder, isGlb } from "./crackSlot";
import { crackHalfWidth } from "./forestPlan";
import { CRACK, FOREST, ROCK } from "./layout";
import { OUT, surfaceMaterial, type PlaceUniforms } from "./placeShaders";

const F = FOREST.floor;
const TEAL = new THREE.Color("#19f5c2");
const BASE = (import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/");

const fissureFrag = /* glsl */ `
uniform float uTop, uBottom, uGlow, uDrop; uniform vec3 uTeal;
void main(){
  float depth = clamp((uTop - vW.y) / (uTop - uBottom), 0., 1.);
  float n = fbm3(vW * .55);
  // Strata: bands of rock down the walls.
  float strata = .75 + .25 * sin(vW.y * 3.1 + n * 4.);
  float rock = (.45 + n) * strata;
  // From the forest: dark rock, darker with depth, in the forest's fog and light.
  vec3 c = vec3(.006, .006, .007) * rock * (1. - smoothstep(0., .45, depth) * .92);
  // The cold light from far below, past the fog: it is what the camera follows down.
  vec3 glow = uTeal * uGlow * smoothstep(.45, 1., depth) * .1 * (.5 + .7 * n);
  // The fall (uDrop): the walls lit from below by the reactor's glow, stronger with depth. Faces turned down catch
  // the most, and the rock goes dark with distance, so walls, roots and boulders stream past out of the dark.
  vec3 nn = normalize(vN) * (gl_FrontFacing ? 1. : -1.);
  float below = .3 + .7 * clamp(.3 - .8 * nn.y, 0., 1.);
  float k = .15 + .85 * pow(max(depth, 0.), 1.3);
  float near = exp(-distance(vW, cameraPosition) * .09);
  vec3 fall = rock * (uTeal * .05 * k * below + vec3(.008, .01, .012) * (.4 + k)) * near;
  if (vUv.y > .5) {
    // The cap: the reactor's glow far below. It dissolves as the fall's light hands over to the reactor itself.
    float d = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
    // It thins out as the camera comes down onto it, so the camera drops through light, not into a flat floor.
    float above = smoothstep(.5, 6., cameraPosition.y - vW.y);
    // Solid while the forest or the fall is lit; it only dissolves as the fall hands over to the reactor.
    if (d > (uLight > 0. ? 1. : uDrop) * above) discard;
    gl_FragColor = vec4(uTeal * uGlow * (.03 * uLight + .22 * uDrop) * (.6 + .5 * n), 1.);
    ${OUT}
    return;
  }
  gl_FragColor = vec4(place(c, vW) + fall * uDrop + glow * max(uLight, uDrop), 1.);
  ${OUT}
}`;

/** The procedural fissure: the crack's outline carried straight down through the rock. */
export function fissureGeometry(): THREE.BufferGeometry {
  const L = CRACK.halfLength;
  const loop: [number, number][] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const u = -L + (2 * L * i) / N;
    loop.push([u, crackHalfWidth(u)]);
  }
  for (let i = N - 1; i > 0; i--) {
    const u = -L + (2 * L * i) / N;
    loop.push([u, -crackHalfWidth(u)]);
  }
  const pos: number[] = [];
  const at = ([u, v]: [number, number], y: number) => crackToWorld([u, y, v]);
  const top = 0.02;
  const bottom = -CRACK_SLOT.depth - 1;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    pos.push(...at(a, top), ...at(b, top), ...at(a, bottom), ...at(b, top), ...at(b, bottom), ...at(a, bottom));
  }
  const walls = pos.length / 3;
  // The cap at the bottom (uv.y 1): the reactor's glow seen up the fissure, so the way down is light, not a hole.
  const capY = -CRACK_SLOT.depth + 0.5;
  for (let i = 0; i < loop.length; i++) pos.push(...at([0, 0], capY), ...at(loop[i], capY), ...at(loop[(i + 1) % loop.length], capY));
  const uv = new Array((pos.length / 3) * 2).fill(0);
  for (let i = walls; i < pos.length / 3; i++) uv[i * 2 + 1] = 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** From the forest only the crack's top shows (the rock below is dark until the fall): the walk draws the model's
 *  triangles reaching above this depth (m), the fall draws them all. */
export const WALK_DEPTH = -3;

export interface CrackHandle {
  group: THREE.Group;
  /** "procedural" until a crack.glb has replaced it. */
  source(): "procedural" | "glb";
  /** The fall's light (storyPlan.ts dropLight): lights the walls from below and draws the model's deep part. */
  update(drop: number): void;
  dispose(): void;
}

/** The crack, procedural at once, swapped for CRACK_SLOT.url's model if one is served and `model` allows it (the low
 *  tier keeps the procedural one: the model is ~27k triangles and 1.3 MB). */
export function makeCrack(u: PlaceUniforms, glow: THREE.IUniform<number>, fetchImpl: (url: string) => Promise<Response> = fetch, model = true): CrackHandle {
  const group = new THREE.Group();
  group.name = "forest:crack";
  const drop = { value: 0 };
  const mat = surfaceMaterial(u, { uTop: { value: F }, uBottom: { value: ROCK.bottom }, uGlow: glow, uDrop: drop, uTeal: { value: TEAL } }, fissureFrag, { side: THREE.DoubleSide });
  const geo = fissureGeometry();
  const fissure = new THREE.Mesh(geo, mat);
  fissure.name = "forest:fissure";
  fissure.raycast = () => {};
  group.add(fissure);
  let source: "procedural" | "glb" = "procedural";
  let live = true;
  let glb: THREE.Object3D | null = null;
  // The model's meshes, their triangles top first, and how many indices the walk draws (depthOrder).
  const parts: { geometry: THREE.BufferGeometry; above: number; all: number }[] = [];

  if (model) fetchImpl(BASE + CRACK_SLOT.url)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((buf) => {
      if (!live || !buf || !isGlb(buf)) return;
      new GLTFLoader().parse(buf, BASE, (gltf) => {
        if (!live) return;
        glb = gltf.scene;
        glb.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.material = mat;
            m.raycast = () => {};
            const g = m.geometry as THREE.BufferGeometry;
            if (g.index) {
              const o = depthOrder(g.index.array, g.attributes.position.array, WALK_DEPTH);
              g.setIndex(new THREE.BufferAttribute(o.index, 1));
              parts.push({ geometry: g, above: o.above, all: o.index.length });
            }
          }
        });
        glb.position.set(...crackToWorld([0, 0, 0]));
        glb.rotation.y = CRACK_YAW;
        // The procedural fissure stays behind it, at the floor's cut: it closes any gap between the cut and the
        // model's walls.
        group.add(glb);
        setDrop(drop.value);
        source = "glb";
      }, (e) => console.warn("world: crack.glb didn't parse; keeping the procedural crack", e));
    })
    .catch(() => undefined);

  function setDrop(d: number) {
    drop.value = d;
    for (const p of parts) p.geometry.setDrawRange(0, d > 0 ? p.all : p.above);
  }

  return {
    group,
    source: () => source,
    update: setDrop,
    dispose() {
      live = false;
      geo.dispose();
      mat.dispose();
      glb?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}
