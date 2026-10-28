// The forest's modelled trees (the lead's Blender export, world/models/forest/trees.glb): three trunk variants, each
// at four levels of detail (lod0 the hero, 1 near, 2 mid, 3 far) with real limbs and flared roots, and leaf cards
// up in the crown (lod0–2). The forest is static, so every tree of a level is merged into one world-space geometry:
// four bark draws and one for the leaves, which replace the procedural trunks, roots and branch cards (forestGeometry.ts)
// once the files are in. Each tree keeps its place, lean and tint from the layout; its variant comes from a hash of its
// index, it is spun about its axis, and scaled evenly from its chest radius (real limbs don't survive the old
// unit trunk's 40-times vertical stretch). Pure, so the tests (and the budget) hold it; Forest.tsx draws it.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TierName } from "../../core/quality";
import type { ForestLayout } from "./forestGeometry";
import type { Tree } from "./forestPlan";
import { FOREST } from "./layout";
import { walkXZ } from "./path";

export const TREES_URL = "world/models/forest/trees.glb";
export const BARK_ALBEDO_URL = "world/models/forest/bark_albedo.jpg";
export const BARK_NORMAL_URL = "world/models/forest/bark_normal.jpg";
export const LEAVES_URL = "world/models/forest/leaves.png";

export const TREE_VARIANTS = ["treeA", "treeB", "treeC"] as const;
/** Every variant's radius at chest height (1.3 m up): a tree's scale is its own chest radius over this. */
export const CHEST_R = 0.8;

export type TreeLod = 0 | 1 | 2 | 3;

/** How many of the near trunks closest to the walk get the hero level, per tier. */
export const HERO_TREES: Record<TierName, number> = { low: 0, high: 12, ultra: 16 };

export interface TreeAt {
  /** Index in the layout's trees (far trees after them, at 1000 + their index). */
  index: number;
  variant: number;
  lod: TreeLod;
  matrix: THREE.Matrix4;
  tint: number;
}

const hash = (i: number) => {
  const s = Math.sin(i * 91.17 + 7.3) * 43758.5453;
  return s - Math.floor(s);
};

/** Which variant and level each tree is drawn at, and where. */
export function treePlan(layout: ForestLayout, tier: TierName): TreeAt[] {
  const walk = walkXZ();
  const toWalk = (t: Tree) => Math.min(...walk.map(([a, b]) => Math.hypot(a - t.x, b - t.z)));
  const near = layout.trees.map((t, i) => [t, i] as const).filter(([t]) => t.layer === 0);
  const heroes = new Set(near.sort((a, b) => toWalk(a[0]) - toWalk(b[0])).slice(0, HERO_TREES[tier]).map(([, i]) => i));
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const place = (t: Tree, index: number, lod: TreeLod): TreeAt => {
    const s = t.radius / CHEST_R;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(t.x, FOREST.floor, t.z),
      q.setFromEuler(e.set(t.lean[0], hash(index + 3) * Math.PI * 2, t.lean[1])).clone(),
      new THREE.Vector3(s, s * (0.92 + 0.16 * hash(index + 11)), s),
    );
    return { index, variant: Math.floor(hash(index) * TREE_VARIANTS.length) % TREE_VARIANTS.length, lod, matrix, tint: t.tint };
  };
  return [
    ...layout.trees.map((t, i) => place(t, i, t.layer === 0 ? (heroes.has(i) ? 0 : 1) : t.layer === 1 ? 2 : 3)),
    ...layout.far.map((t, i) => place(t, 1000 + i, 3)),
  ];
}

/** The variants' geometries by node name: `treeA_lod0`, `treeA_leaves_lod0`, ... */
export type TreeMeshes = Partial<Record<string, THREE.BufferGeometry>>;

export const barkName = (variant: number, lod: TreeLod) => `${TREE_VARIANTS[variant]}_lod${lod}`;
export const leavesName = (variant: number, lod: TreeLod) => `${TREE_VARIANTS[variant]}_leaves_lod${lod}`;

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Each placed copy of a variant: its attributes in world space, the tree's tint on every vertex (aTint). */
function placed(g: THREE.BufferGeometry, t: TreeAt, keep: string[]): THREE.BufferGeometry {
  const c = new THREE.BufferGeometry();
  for (const k of keep) if (g.attributes[k]) c.setAttribute(k, g.attributes[k].clone());
  if (g.index) c.setIndex(g.index.clone());
  c.applyMatrix4(t.matrix);
  c.setAttribute("aTint", new THREE.BufferAttribute(new Float32Array(c.attributes.position.count).fill(t.tint), 1));
  return c;
}

export interface MergedTrees {
  /** One geometry per level that has trees (position, normal, uv, the baked AO in color, aTint). */
  bark: { lod: TreeLod; geometry: THREE.BufferGeometry }[];
  /** All the leaf cards, one geometry (position, normal, uv, aTint). */
  leaves: THREE.BufferGeometry | null;
  /** Triangles in all of it. */
  triangles: number;
}

/** The plan's trees merged per level (missing variants or levels are left out). */
export function mergeTrees(plan: readonly TreeAt[], meshes: TreeMeshes): MergedTrees {
  const bark: MergedTrees["bark"] = [];
  let triangles = 0;
  for (const lod of [0, 1, 2, 3] as const) {
    const parts = plan.filter((t) => t.lod === lod).flatMap((t) => {
      const g = meshes[barkName(t.variant, lod)];
      return g ? [placed(g, t, ["position", "normal", "uv", "color"])] : [];
    });
    if (!parts.length) continue;
    const geometry = mergeGeometries(parts, false)!;
    parts.forEach((p) => p.dispose());
    bark.push({ lod, geometry });
    triangles += tris(geometry);
  }
  const leafParts = plan.flatMap((t) => {
    const g = t.lod < 3 ? meshes[leavesName(t.variant, t.lod)] : undefined;
    return g ? [placed(g, t, ["position", "normal", "uv"])] : [];
  });
  const leaves = leafParts.length ? mergeGeometries(leafParts, false)! : null;
  leafParts.forEach((p) => p.dispose());
  if (leaves) triangles += tris(leaves);
  return { bark, leaves, triangles };
}

/** The variants' geometries out of the loaded GLB's scene, by node name. */
export function treeMeshes(scene: THREE.Object3D): TreeMeshes {
  const out: TreeMeshes = {};
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    out[m.name] = (m.geometry as THREE.BufferGeometry).clone().applyMatrix4(m.matrixWorld);
  });
  return out;
}
