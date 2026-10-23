// The robots lying in the forest's moss: the real robots SANT works with (their GLBs in world/models/robots/,
// exported from Blender: one mesh each, metres, y up, base at the origin, the arm reaching along +x in its display
// pose), abandoned, waiting for data. Each is posed whole (there are no joints in a GLB): toppled on its side, face
// down, on its back with the arm up, half buried, or leaning against a trunk. Pure and seed-free (hand-placed along
// the walk, then nudged clear of the trunks, logs, crack and each other), so the tests hold it; robotWrecks.ts builds
// the geometry, robotLod.ts its levels of detail.
import * as THREE from "three";
import type { TierName } from "../../core/quality";
import type { Log, Tree } from "./forestPlan";
import { inCrack, toLog } from "./forestPlan";

type XZ = readonly [number, number];

/** The robot models, in the order the shelf lists them. */
export const ROBOT_IDS = ["franka", "fr3", "so101", "piper", "openarm", "ur5e", "xarm6"] as const;
export type RobotId = (typeof ROBOT_IDS)[number];

export const robotUrl = (id: RobotId) => `world/models/robots/${id}.glb`;

/**
 * Robots the forest draws from a clean re-export of its own (welded, no open edges; world/models/forest/robots/), while
 * the workshop's wall keeps the originals (it cuts them into their link shells, which the weld joins).
 */
export const FOREST_EXPORTS: readonly RobotId[] = ["fr3", "openarm"];
export const forestRobotUrl = (id: RobotId) => (FOREST_EXPORTS.includes(id) ? `world/models/forest/robots/${id}.glb` : robotUrl(id));

/** Each model's bounds (m), as its GLB has them; a test checks them against the files. */
export const ROBOT_BOUNDS: Record<RobotId, { min: [number, number, number]; max: [number, number, number] }> = {
  franka: { min: [-0.117, 0, -0.134], max: [0.548, 0.722, 0.126] },
  fr3: { min: [-0.125, -0.001, -0.129], max: [0.54, 0.722, 0.13] },
  so101: { min: [-0.085, 0, -0.056], max: [0.224, 0.208, 0.055] },
  piper: { min: [-0.087, 0, -0.074], max: [0.416, 0.521, 0.071] },
  openarm: { min: [-0.051, 0.001, -0.14], max: [0.382, 0.437, 0.066] },
  ur5e: { min: [-0.197, 0, -0.21], max: [0.352, 0.813, 0.076] },
  xarm6: { min: [-0.12, 0, -0.118], max: [0.432, 0.655, 0.088] },
};

/** Larger than life, like a wreck in a forest of 30 m trunks; one scale for all, so they keep their proportions. */
export const HEROIC = 2.4;

export type PoseName = "lying_side" | "face_down" | "lying_back" | "half_buried" | "tipped" | "leaning";

export interface Pose {
  /** Euler XYZ (rad) turning the model (y up, arm along +x) onto the moss. */
  lay: [number, number, number];
  /** How much of its height is under the moss (0-1). */
  sink: number;
}

export const POSES: Record<PoseName, Pose> = {
  // Toppled over sideways, still in its working pose.
  lying_side: { lay: [Math.PI / 2, 0, 0.15], sink: 0.3 },
  // Fallen forward, the arm driven into the moss.
  face_down: { lay: [0.2, 0, -1.3], sink: 0.3 },
  // Fallen back, the arm reaching up out of the moss.
  lying_back: { lay: [0.15, 0, 1.4], sink: 0.35 },
  // Base swallowed by the ground, tilted, the arm still above it.
  half_buried: { lay: [0.35, 0, 0.45], sink: 0.5 },
  // Tipped over at an angle, one side in the moss.
  tipped: { lay: [1.15, 0, 0.35], sink: 0.25 },
  // Standing, but slumped back against a trunk (its top leans toward -x, turned to face away from the trunk).
  leaning: { lay: [0, 0, 0.5], sink: 0.15 },
};

export interface RobotSpot {
  id: RobotId;
  pose: PoseName;
  x: number;
  z: number;
  /** Turn about the vertical (rad). */
  yaw: number;
  /** World metres per model metre. */
  scale: number;
  /** How much of its height is under the moss (0-1). */
  sink: number;
  /** Ground radius it needs clear (m). */
  footprint: number;
  /** The trunk it leans on (robotWrecks.ts slides it against the bark). */
  lean?: { x: number; z: number; radius: number };
}

/** Where along the walk's ground part (0 first ground point, 1 the crack) each lies, which side (+1 left of the
 *  walk's direction) and how far out (m), in its pose. Hand-chosen so the camera passes each in turn,
 *  then nudged until each is in clear view (no trunk between) for a stretch of the walk. */
export interface SpotDesign { id: RobotId; pose: PoseName; at: number; side: 1 | -1; off: number; yaw: number }

export const DESIGN: SpotDesign[] = [
  { id: "franka", pose: "lying_side", at: 0.205, side: 1, off: 3.4, yaw: 0.4 },
  { id: "so101", pose: "tipped", at: 0.3, side: -1, off: 2.6, yaw: 2.1 },
  { id: "piper", pose: "lying_back", at: 0.44, side: 1, off: 2.6, yaw: -0.8 },
  { id: "fr3", pose: "half_buried", at: 0.55, side: -1, off: 2.6, yaw: 1.1 },
  { id: "openarm", pose: "face_down", at: 0.61, side: 1, off: 3, yaw: 2.8 },
  { id: "ur5e", pose: "leaning", at: 0.78, side: 1, off: 3.4, yaw: 0 },
  { id: "xarm6", pose: "lying_side", at: 0.9, side: -1, off: 2.6, yaw: 0.9 },
];

/** Half the widest horizontal extent of the model once laid down and scaled, plus a margin (m). */
function footprintOf(id: RobotId, pose: Pose): number {
  const { min, max } = ROBOT_BOUNDS[id];
  const r = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...pose.lay));
  const box = new THREE.Box3();
  for (let i = 0; i < 8; i++) box.expandByPoint(new THREE.Vector3(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]).applyMatrix4(r));
  return (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2) * HEROIC * 0.85 + 0.2;
}

/** The spots, placed along the walk and nudged (outward, then along) until clear. */
export function robotSpots(walk: readonly XZ[], forest: readonly Tree[], fallen: readonly Log[], design: readonly SpotDesign[] = DESIGN): RobotSpot[] {
  const ground = walk.slice(Math.floor(walk.length * 0.35));
  const near = (x: number, z: number) => Math.min(...walk.map(([a, b]) => Math.hypot(a - x, b - z)));
  const out: RobotSpot[] = [];
  for (const d of design) {
    const pose = POSES[d.pose];
    const footprint = footprintOf(d.id, pose);
    const i = Math.min(ground.length - 2, Math.floor(d.at * (ground.length - 1)));
    const [ax, az] = ground[i];
    const [bx, bz] = ground[i + 1];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    const nx = -tz * d.side, nz = tx * d.side;
    const clear = (x: number, z: number, skip?: Tree) =>
      near(x, z) > 2.2 && near(x, z) < 8 && !inCrack(x, z, -1.5) &&
      forest.every((t) => t === skip || Math.hypot(t.x - x, t.z - z) > t.radius + footprint) &&
      fallen.every((l) => Math.hypot(l.x - x, l.z - z) > l.length / 2 + footprint && toLog(l, x, z) > l.radius + footprint) &&
      out.every((o) => Math.hypot(o.x - x, o.z - z) > o.footprint + footprint);
    const base = { id: d.id, pose: d.pose, scale: HEROIC, sink: pose.sink, footprint };

    if (d.pose === "leaning") {
      // The nearest trunks to the designed place; the robot stands on the side of one facing the walk.
      const px = ax + nx * d.off, pz = az + nz * d.off;
      const trunks = forest.filter((t) => t.layer < 2 && Math.hypot(t.x - px, t.z - pz) < 7).sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
      let spot: RobotSpot | null = null;
      search: for (const t of trunks)
        for (let k = 0; k < 12; k++) {
          // Round the trunk from the side facing the designed place.
          const a0 = Math.atan2(pz - t.z, px - t.x);
          const a = a0 + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.35;
          const r = t.radius + footprint + 0.05;
          const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
          if (!clear(x, z, t)) continue;
          // The model's -x (where its top leans) toward the trunk.
          const dx = t.x - x, dz = t.z - z;
          spot = { ...base, x, z, yaw: Math.atan2(dz, -dx), lean: { x: t.x, z: t.z, radius: t.radius } };
          break search;
        }
      if (!spot) throw new Error(`world: no trunk for the ${d.id} to lean on`);
      out.push(spot);
      continue;
    }

    let placed: [number, number] | null = null;
    search: for (let k = 0; k < 12; k++)
      for (const along of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) {
        const off = d.off + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.5;
        const x = ax + nx * off + tx * along;
        const z = az + nz * off + tz * along;
        if (clear(x, z)) {
          placed = [x, z];
          break search;
        }
      }
    if (!placed) throw new Error(`world: no clear spot for the ${d.id} in the forest`);
    out.push({ ...base, x: placed[0], z: placed[1], yaw: d.yaw });
  }
  return out;
}

export interface RobotTier {
  /** The robots shown. */
  ids: readonly RobotId[];
  /** The far level: each robot simplified to this many triangles (robotSimplify.ts). */
  coarse: number;
  /** The near level's triangles (0: no near level). */
  detail: number;
  /** Beyond this distance (m) a robot isn't drawn at all (the fog has it). */
  far: number;
  /** Within this distance (m) a robot is drawn in detail (0: never); `band` > 0 draws both levels over its last metres. */
  near: number;
  band: number;
}

/**
 * Robots left out of the forest (none now: fr3's original GLB was a triangle soup, 69% of its edges open, until the
 * clean forest export; notes/2026-10-22-site-intro-forest.md).
 */
export const FOREST_SKIP: readonly RobotId[] = [];
const FOREST_IDS = ROBOT_IDS.filter((id) => !FOREST_SKIP.includes(id));

export const ROBOT_TIERS: Record<TierName, RobotTier> = {
  // Phones and slow GPUs: four robots, spaced along the walk, coarse only (one level, no dissolve).
  low: { ids: ["franka", "piper", "ur5e", "xarm6"], coarse: 1600, detail: 0, near: 0, band: 0, far: 24 },
  high: { ids: FOREST_IDS, coarse: 1900, detail: 4400, near: 4.5, band: 0, far: 26 },
  ultra: { ids: FOREST_IDS, coarse: 2400, detail: 6200, near: 5, band: 0, far: 30 },
};
