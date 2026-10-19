// What every cartridge on screen shares: cartridge.glb's parts (shell, label, window, inner, reels,
// tape, pins, screw) with each node's own transform baked into its geometry, so one instance matrix
// places them all; the slot matrices; and the one label atlas (labels.ts), redrawn once the fonts
// arrive.
import * as THREE from "three";
import { drawAtlas, tileUv } from "./labels";
import type { Slot } from "./layout";

export interface Part {
  name: string;
  geometry: THREE.BufferGeometry;
  /** The GLB's own material, the source for the tier's (materials.ts). */
  source: THREE.Material;
}

const partsCache = new WeakMap<THREE.Object3D, Part[]>();

/** The parts of a loaded cartridge GLB, in file order. Cached per scene. */
export function cartridgeParts(scene: THREE.Object3D): Part[] {
  const hit = partsCache.get(scene);
  if (hit) return hit;
  const parts: Part[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometry = (o.geometry as THREE.BufferGeometry).clone();
    geometry.applyMatrix4(o.matrixWorld);
    parts.push({ name: o.name, geometry, source: o.material as THREE.Material });
  });
  partsCache.set(scene, parts);
  return parts;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export function slotMatrix(slot: Slot, out = new THREE.Matrix4()): THREE.Matrix4 {
  _p.set(...slot.position);
  _q.set(...slot.quaternion);
  _s.setScalar(slot.scale);
  return out.compose(_p, _q, _s);
}

/** Per-instance atlas tiles for a label geometry, as the `aTile` attribute (materials.ts withTiles). */
export function tileAttribute(tiles: readonly number[]): THREE.InstancedBufferAttribute {
  const a = new Float32Array(tiles.length * 4);
  tiles.forEach((t, i) => {
    const r = tileUv(t);
    a.set([r.u, r.v, r.su, r.sv], i * 4);
  });
  return new THREE.InstancedBufferAttribute(a, 4);
}

let atlas: THREE.CanvasTexture | null = null;
const redrawn = new Set<() => void>();

/** The label atlas, made once for the page. `onRedraw` runs when the real fonts replace the fallback. */
export function labelAtlas(onRedraw?: () => void): THREE.CanvasTexture {
  if (onRedraw) redrawn.add(onRedraw);
  if (atlas) return atlas;
  const canvas = document.createElement("canvas");
  drawAtlas(canvas);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  atlas = tex;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts) {
    Promise.all([fonts.load('300 64px "Geist"'), fonts.load('500 24px "Geist"'), fonts.load('400 20px "Geist Mono"')])
      .then(() => {
        drawAtlas(canvas);
        tex.needsUpdate = true;
        redrawn.forEach((fn) => fn());
      })
      .catch(() => {});
  }
  return tex;
}

export function offRedraw(fn: () => void): void {
  redrawn.delete(fn);
}
