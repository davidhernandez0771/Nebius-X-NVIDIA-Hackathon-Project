// The robots on the wall, from their makers' published meshes: each robot's description repo (the
// licences are in C:/dev/assets/robots/SOURCES.md and specs.json), posed and reduced to about 15,000
// triangles in docs/design/blender/robots.blend, exported to web/public/world/models/robots/<id>.glb.
// Each GLB is one mesh, Y up, metres, its base on y = 0 and its arm reaching along +x, with one plain
// colour per primitive (no textures). The wall merges everything into one vertex-coloured geometry
// (wallParts.ts), so a model becomes one geometry with its colours per vertex, and the parts shelves
// show its real pieces: each link shell with the small parts that sit on it.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const BASE = `${import.meta.env.BASE_URL}world/`;

export const MODEL_IDS = ["franka", "fr3", "ur5e", "xarm6", "so101", "piper", "openarm"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const robotModelUrl = (id: string) => `${BASE}models/robots/${id}.glb`;

/**
 * The colours' range on the wall: nothing darker than graphite (the PiPER is black all over, and black
 * shows no shape under the picture lights) and no channel over 0.78 (white under a picture light and
 * the bloom would burn out).
 */
export const MODEL_COLOR = { darkest: new THREE.Color("#2b3034"), brightest: 0.78 };

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function tone(c: THREE.Color): THREE.Color {
  const out = lum(c) < lum(MODEL_COLOR.darkest) ? MODEL_COLOR.darkest.clone() : c.clone();
  const top = Math.max(out.r, out.g, out.b);
  if (top > MODEL_COLOR.brightest) out.multiplyScalar(MODEL_COLOR.brightest / top);
  return out;
}

/** One model as one indexed geometry: position, normal and a colour per vertex (its primitive's). */
export function parseRobotModel(buf: ArrayBuffer): Promise<THREE.BufferGeometry> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      buf,
      "",
      (gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const geos: THREE.BufferGeometry[] = [];
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const src = mesh.geometry;
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", src.getAttribute("position").clone());
          if (src.getAttribute("normal")) g.setAttribute("normal", src.getAttribute("normal").clone());
          else g.computeVertexNormals();
          const n = g.getAttribute("position").count;
          g.setIndex(src.index ? src.index.clone() : [...Array(n).keys()]);
          g.applyMatrix4(mesh.matrixWorld);
          const k = tone((mesh.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1));
          const c = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) c.set([k.r, k.g, k.b], i * 3);
          g.setAttribute("color", new THREE.BufferAttribute(c, 3));
          geos.push(g);
        });
        const out = geos.length ? mergeGeometries(geos) : null;
        geos.forEach((x) => x.dispose());
        if (out) resolve(out);
        else reject(new Error("world: a robot model has no meshes"));
      },
      reject,
    );
  });
}

/** Fetches and parses one robot's model. */
export async function loadRobotModel(id: string, fetchImpl: typeof fetch = fetch): Promise<THREE.BufferGeometry> {
  const res = await fetchImpl(robotModelUrl(id));
  if (!res.ok) throw new Error(`world: ${robotModelUrl(id)}: HTTP ${res.status}`);
  return parseRobotModel(await res.arrayBuffer());
}

/** A piece's triangles must be at least this many, and its box at least this share of the largest's. */
const MIN_TRIS = 40;
const MIN_SHARE = 0.03;
const MAX_PIECES = 8;

/** The dominant direction of a point cloud (power iteration on its covariance). */
function principalAxis(p: ArrayLike<number>, verts: readonly number[]): THREE.Vector3 {
  let mx = 0, my = 0, mz = 0;
  for (const v of verts) {
    mx += p[v * 3];
    my += p[v * 3 + 1];
    mz += p[v * 3 + 2];
  }
  const n = verts.length;
  mx /= n;
  my /= n;
  mz /= n;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const v of verts) {
    const x = p[v * 3] - mx, y = p[v * 3 + 1] - my, z = p[v * 3 + 2] - mz;
    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }
  const a = new THREE.Vector3(0.577, 0.577, 0.577);
  for (let i = 0; i < 40; i++) {
    a.set(xx * a.x + xy * a.y + xz * a.z, xy * a.x + yy * a.y + yz * a.z, xz * a.x + yz * a.y + zz * a.z);
    if (a.lengthSq() < 1e-30) return new THREE.Vector3(0, 1, 0);
    a.normalize();
  }
  return a;
}

/** Stands a piece up: its main axis vertical (and its longest side the height), on y = 0, centred. */
function standUp(g: THREE.BufferGeometry, axis: THREE.Vector3): void {
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0)));
  g.computeBoundingBox();
  let b = g.boundingBox!;
  const w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
  if (w > h && w >= d) g.rotateZ(Math.PI / 2);
  else if (d > h) g.rotateX(Math.PI / 2);
  g.computeBoundingBox();
  b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.computeBoundingBox();
}

/**
 * A model's real pieces, largest first: every link shell (a connected part of the mesh whose box is at
 * least MIN_SHARE of the largest's), with the small parts whose centre sits inside its box (screws, rings,
 * caps), each stood upright on y = 0 and centred. Vertices at the same place and in the same colour count
 * as connected (the export splits them where the normals break).
 */
export function modelPieces(model: THREE.BufferGeometry, max = MAX_PIECES): THREE.BufferGeometry[] {
  const pos = model.getAttribute("position");
  const p = pos.array as ArrayLike<number>;
  const n = pos.count;
  const idx = model.index ? (model.index.array as ArrayLike<number>) : [...Array(n).keys()];
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const join = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let t = 0; t < idx.length; t += 3) {
    join(idx[t], idx[t + 1]);
    join(idx[t], idx[t + 2]);
  }
  // Same place and same colour: the export's split at a hard edge, not a seam between two parts.
  const rgb = model.getAttribute("color");
  const at = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const k = `${Math.round(p[v * 3] * 1e5)},${Math.round(p[v * 3 + 1] * 1e5)},${Math.round(p[v * 3 + 2] * 1e5)},${rgb.getX(v).toFixed(3)},${rgb.getY(v).toFixed(3)}`;
    const w = at.get(k);
    if (w === undefined) at.set(k, v);
    else join(w, v);
  }

  interface Comp { tris: number[]; box: THREE.Box3; vol: number }
  const comps = new Map<number, Comp>();
  const v3 = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(idx[t]);
    let c = comps.get(r);
    if (!c) comps.set(r, (c = { tris: [], box: new THREE.Box3(), vol: 0 }));
    c.tris.push(t);
    for (let k = 0; k < 3; k++) c.box.expandByPoint(v3.fromBufferAttribute(pos as never, idx[t + k]));
  }
  const all = [...comps.values()];
  for (const c of all) {
    const s = c.box.getSize(v3);
    c.vol = Math.max(s.x, 1e-4) * Math.max(s.y, 1e-4) * Math.max(s.z, 1e-4);
  }
  all.sort((a, b) => b.vol - a.vol);
  const shells = all.filter((c) => c.vol >= all[0].vol * MIN_SHARE && c.tris.length >= MIN_TRIS);
  const members = new Map<Comp, Comp[]>(shells.map((s) => [s, [s]]));
  for (const c of all) {
    if (members.has(c)) continue;
    const centre = c.box.getCenter(new THREE.Vector3());
    // The smallest shell around it (shells overlap where links meet).
    let home: Comp | null = null;
    for (const s of shells) if (s.box.clone().expandByScalar(0.002).containsPoint(centre) && (!home || s.vol < home.vol)) home = s;
    if (home) members.get(home)!.push(c);
  }

  const norm = model.getAttribute("normal");
  const col = model.getAttribute("color");
  const out: THREE.BufferGeometry[] = [];
  for (const s of shells) {
    const remap = new Map<number, number>();
    const index: number[] = [];
    for (const c of members.get(s)!)
      for (const t of c.tris)
        for (let k = 0; k < 3; k++) {
          const v = idx[t + k];
          let m = remap.get(v);
          if (m === undefined) remap.set(v, (m = remap.size));
          index.push(m);
        }
    const verts = [...remap.keys()];
    const take = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number) => {
      const arr = new Float32Array(verts.length * size);
      verts.forEach((v, i) => {
        for (let k = 0; k < size; k++) arr[i * size + k] = a.getComponent(v, k);
      });
      return new THREE.BufferAttribute(arr, size);
    };
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", take(pos, 3));
    g.setAttribute("normal", take(norm, 3));
    g.setAttribute("color", take(col, 3));
    g.setIndex(index);
    standUp(g, principalAxis(p, verts));
    out.push(g);
  }
  const vol = (g: THREE.BufferGeometry) => {
    const sz = g.boundingBox!.getSize(new THREE.Vector3());
    return sz.x * sz.y * sz.z;
  };
  return out.sort((a, b) => vol(b) - vol(a)).slice(0, max);
}
