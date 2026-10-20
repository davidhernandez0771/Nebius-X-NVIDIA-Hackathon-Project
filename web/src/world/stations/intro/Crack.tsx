// The crack in the forest floor, behind one component so a Blender model can replace it (crackSlot.ts). Built
// procedurally until then: the crack's lens outline (forestPlan.ts crackHalfWidth) carried straight down through
// the rock as a fissure, dark, with a cold glow from the reactor far below. If a binary glTF sits at
// CRACK_SLOT.url it replaces the fissure: placed in the slot's frame, drawn with the same rock shader (so it fades
// with the forest's light and keeps the glow). The floor keeps cutting the same lens either way.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CRACK_SLOT, CRACK_YAW, crackToWorld, isGlb } from "./crackSlot";
import { crackHalfWidth } from "./forestPlan";
import { CRACK, FOREST, ROCK } from "./layout";
import { OUT, surfaceMaterial, type PlaceUniforms } from "./placeShaders";

const F = FOREST.floor;
const TEAL = new THREE.Color("#19f5c2");
const BASE = (import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/");

const fissureFrag = /* glsl */ `
uniform float uTop, uBottom, uGlow; uniform vec3 uTeal;
void main(){
  float depth = clamp((uTop - vW.y) / (uTop - uBottom), 0., 1.);
  float n = fbm3(vW * .55);
  // Strata: bands of rock down the walls.
  float strata = .75 + .25 * sin(vW.y * 3.1 + n * 4.);
  vec3 c = vec3(.006, .006, .007) * (.45 + n) * strata * (1. - smoothstep(0., .45, depth) * .92);
  // The cold light from far below, past the fog: it is what the camera follows down.
  vec3 glow = uTeal * uGlow * smoothstep(.45, 1., depth) * .1 * (.5 + .7 * n);
  gl_FragColor = vec4(place(c, vW) + glow * uLight, 1.);
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
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length).fill(0), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  return g;
}

export interface CrackHandle {
  group: THREE.Group;
  /** "procedural" until a crack.glb has replaced it. */
  source(): "procedural" | "glb";
  dispose(): void;
}

/** The crack, procedural at once, swapped for CRACK_SLOT.url's model if one is served. */
export function makeCrack(u: PlaceUniforms, glow: THREE.IUniform<number>, fetchImpl: typeof fetch = fetch): CrackHandle {
  const group = new THREE.Group();
  group.name = "forest:crack";
  const mat = surfaceMaterial(u, { uTop: { value: F }, uBottom: { value: ROCK.bottom }, uGlow: glow, uTeal: { value: TEAL } }, fissureFrag, { side: THREE.DoubleSide });
  const geo = fissureGeometry();
  const fissure = new THREE.Mesh(geo, mat);
  fissure.name = "forest:fissure";
  fissure.raycast = () => {};
  group.add(fissure);
  let source: "procedural" | "glb" = "procedural";
  let live = true;
  let model: THREE.Object3D | null = null;

  fetchImpl(BASE + CRACK_SLOT.url)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((buf) => {
      if (!live || !buf || !isGlb(buf)) return;
      new GLTFLoader().parse(buf, BASE, (gltf) => {
        if (!live) return;
        model = gltf.scene;
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.material = mat;
            m.raycast = () => {};
          }
        });
        model.position.set(...crackToWorld([0, 0, 0]));
        model.rotation.y = CRACK_YAW;
        group.remove(fissure);
        group.add(model);
        source = "glb";
      }, (e) => console.warn("world: crack.glb didn't parse; keeping the procedural crack", e));
    })
    .catch(() => undefined);

  return {
    group,
    source: () => source,
    dispose() {
      live = false;
      geo.dispose();
      mat.dispose();
      model?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}
