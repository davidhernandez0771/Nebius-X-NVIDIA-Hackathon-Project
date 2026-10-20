// What every cartridge on screen shares: cartridge.glb's parts (shell, label, window, inner, reels,
// tape, pins, screw) with each node's own transform baked into its geometry, so one instance matrix
// places them all; the slot matrices; and the one label atlas (labels.ts), redrawn once the fonts
// arrive and its saved cartridges' tiles again whenever the bench saves or removes one.
import * as THREE from "three";
import { drawAtlas, drawDraftTile, drawSavedTiles, setDraftTileArt, tileUv, type LabelArt } from "./labels";
import type { Slot } from "./layout";
import { subscribeSaved } from "./saved";

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

/** Half the shell's size (cartridge.glb and the LOD alike), metres before the slot's scale. */
export const CARTRIDGE_HALF = [1.15, 1.25, 0.17] as const;

/**
 * A library slot's matrix. layout.json's library rotations turn the LOD's face to the room, but the
 * shelves are 1.6 m deep and the slots 0.25 m apart: Blender stands them spine-out, like books. Face-out,
 * five 1.38 m faces overlapped in every slot and their slightly different leans interleaved in stripes
 * that crawled with every camera move (the wall's flicker). A quarter turn about the cartridge's own
 * vertical axis stands it spine-out.
 */
const SPINE_OUT = new THREE.Matrix4().makeRotationY(Math.PI / 2);
export function libraryMatrix(slot: Slot, out = new THREE.Matrix4()): THREE.Matrix4 {
  return slotMatrix(slot, out).multiply(SPINE_OUT);
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
  subscribeSaved(() => {
    drawSavedTiles(canvas);
    tex.needsUpdate = true;
    redrawn.forEach((fn) => fn());
  });
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

/** The bench's draft as the room view's turntable shows it: its tile reprinted (one atlas upload). */
export function redrawDraftTile(art: LabelArt): void {
  setDraftTileArt(art);
  if (!atlas) return;
  drawDraftTile(atlas.image as HTMLCanvasElement);
  atlas.needsUpdate = true;
  redrawn.forEach((fn) => fn());
}
