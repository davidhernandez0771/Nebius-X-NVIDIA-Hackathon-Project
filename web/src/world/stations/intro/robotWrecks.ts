// The robots lying in the forest's moss, as one geometry and one draw: each robot's GLB (merged into one model, its
// parts' colours kept per vertex), posed whole in its spot of forestRobots.ts: laid down by the pose, scaled, turned
// to the spot's yaw, sunk by its fraction, and a leaning one slid against its trunk's bark. Every robot is there at
// two levels of detail (robotLod.ts): `update` picks, from the camera's distance, which robots' triangles the index
// list holds. Each vertex carries the model's own height in uv.x (the panel seams the forest's shader draws), its
// level in uv.y and its robot's place in aSpot (the shader dissolves the two levels into each other by distance).
import * as THREE from "three";
import { POSES, type RobotId, type RobotSpot, type RobotTier } from "./forestRobots";
import { clusterLod, lodLevels, packIndices, type Levels, type LodMesh, type Ranges } from "./robotLod";

/** A loaded GLB's meshes, merged into one model in the GLB's frame, each part's base colour on its vertices. */
export function modelFromScene(scene: THREE.Object3D): LodMesh {
  scene.updateMatrixWorld(true);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry as THREE.BufferGeometry;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    const c = ((Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1);
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      pos.push(v.x, v.y, v.z);
      if (n) v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
      else v.set(0, 1, 0);
      nor.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  });
  return { position: new Float32Array(pos), normal: new Float32Array(nor), color: new Float32Array(col), index: Uint32Array.from(idx) };
}

/** The model's placement before it is moved onto its spot: laid down, scaled, turned. */
function poseMatrix(s: RobotSpot): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeRotationY(s.yaw)
    .multiply(new THREE.Matrix4().makeScale(s.scale, s.scale, s.scale))
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...POSES[s.pose].lay)));
}

/** Where the posed model goes: its footprint's centre on the spot, sunk by its fraction, slid against a trunk. */
function placement(model: LodMesh, s: RobotSpot, floor: number): THREE.Matrix4 {
  const m = poseMatrix(s);
  const p = model.position;
  const n = p.length / 3;
  const posed = new Float32Array(p.length);
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  for (let i = 0; i < n; i++) {
    v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(m);
    posed.set([v.x, v.y, v.z], i * 3);
    box.expandByPoint(v);
  }
  const h = box.max.y - box.min.y;
  let tx = s.x - (box.min.x + box.max.x) / 2;
  const ty = floor - box.min.y - s.sink * h;
  let tz = s.z - (box.min.z + box.max.z) / 2;
  if (s.lean) {
    // Slide toward the trunk until the nearest part above the moss touches its bark.
    const { x: cx, z: cz, radius } = s.lean;
    let dx = cx - s.x, dz = cz - s.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const gap = (t: number) => {
      let g = Infinity;
      for (let i = 0; i < n; i++) {
        if (posed[i * 3 + 1] + ty < floor + 0.05) continue;
        g = Math.min(g, Math.hypot(posed[i * 3] + tx + dx * t - cx, posed[i * 3 + 2] + tz + dz * t - cz) - radius);
      }
      return g;
    };
    // From well back (clear) to its middle on the trunk's axis (touching for sure), never past it.
    let lo = -3, hi = len;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (gap(mid) > 0) lo = mid;
      else hi = mid;
    }
    tx += dx * lo;
    tz += dz * lo;
  }
  return new THREE.Matrix4().makeTranslation(tx, ty, tz).multiply(m);
}

export interface Wrecks {
  geometry: THREE.BufferGeometry;
  /** Each robot's span of the full index list, per level (in the order of the robots shown). */
  ranges: Ranges;
  /** Where each robot shown lies (its spot, on the floor). */
  centers: THREE.Vector3[];
  /** Picks each robot's level from the camera's position; returns the indices drawn. */
  update(camera: THREE.Vector3): number;
}

/** Every shown robot whose model loaded, at both levels (or the coarse one alone), in one geometry. */
export function buildWrecks(models: Partial<Record<RobotId, LodMesh>>, spots: readonly RobotSpot[], tier: RobotTier, floor: number): Wrecks {
  const shown = spots.filter((s) => tier.ids.includes(s.id) && models[s.id]);
  const levels: { mesh: LodMesh; matrix: THREE.Matrix4; spot: RobotSpot; level: 0 | 1; robot: number }[] = [];
  shown.forEach((s, robot) => {
    const model = models[s.id]!;
    const matrix = placement(model, s, floor);
    levels.push({ mesh: clusterLod(model, tier.coarse), matrix, spot: s, level: 0, robot });
    if (tier.near > 0) levels.push({ mesh: clusterLod(model, tier.detail), matrix, spot: s, level: 1, robot });
  });
  const verts = levels.reduce((k, l) => k + l.mesh.position.length / 3, 0);
  const tris = levels.reduce((k, l) => k + l.mesh.index.length, 0);
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const aSpot = new Float32Array(verts * 3);
  const all = new Uint32Array(tris);
  const ranges: Ranges = { coarse: [], detail: [] };
  const v = new THREE.Vector3();
  let vo = 0, io = 0;
  for (const l of levels) {
    const nm = new THREE.Matrix3().getNormalMatrix(l.matrix);
    const n = l.mesh.position.length / 3;
    for (let i = 0; i < n; i++) {
      v.fromArray(l.mesh.position, i * 3);
      uv[(vo + i) * 2] = v.y;
      uv[(vo + i) * 2 + 1] = l.level;
      v.applyMatrix4(l.matrix).toArray(position, (vo + i) * 3);
      v.fromArray(l.mesh.normal, i * 3).applyMatrix3(nm).normalize().toArray(normal, (vo + i) * 3);
      aSpot.set([l.spot.x, floor, l.spot.z], (vo + i) * 3);
    }
    color.set(l.mesh.color, vo * 3);
    for (let i = 0; i < l.mesh.index.length; i++) all[io + i] = l.mesh.index[i] + vo;
    (l.level ? ranges.detail : ranges.coarse).push([io, io + l.mesh.index.length]);
    vo += n;
    io += l.mesh.index.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("aSpot", new THREE.BufferAttribute(aSpot, 3));
  const index = new THREE.BufferAttribute(new Uint32Array(tris), 1);
  index.setUsage(THREE.DynamicDrawUsage);
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  const centers = shown.map((s) => new THREE.Vector3(s.x, floor, s.z));
  let last = "";
  let count = 0;
  return {
    geometry,
    ranges,
    centers,
    update(camera) {
      const chosen: Levels[] = centers.map((c) => lodLevels(c.distanceTo(camera), tier));
      const key = chosen.map((l) => `${+l.coarse}${+l.detail}`).join();
      if (key === last) return count;
      last = key;
      count = packIndices(all, ranges, chosen, index.array as Uint32Array);
      index.needsUpdate = true;
      geometry.setDrawRange(0, count);
      return count;
    },
  };
}
