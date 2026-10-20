// The robots lying in the forest's moss: one spot per robot SANT is getting real meshes for (converted to GLB in
// Blender later), plus a gripper half buried. Pure and seeded-free (hand-placed along the walk, then nudged clear
// of the trunks, logs, crack and each other), so the tests hold it and the GLBs can drop into the same spots.
//
// Until the GLBs arrive every spot shows the Franka, assembled from its URDF's collision meshes in the spot's pose
// (Forest.tsx), sized by that robot's reach. A real robot then replaces it: same x, z, yaw, scale and sink; the pose's
// `lay` turns the body (z-up URDF frame turned y-up) onto the moss; its `joints` are the Franka stand-in's.
import type { Log, Tree } from "./forestPlan";
import { inCrack, toLog } from "./forestPlan";

type XZ = readonly [number, number];

/** The robots with real meshes on the way, in the order the shelf lists them. */
export const ROBOT_IDS = ["franka", "so101", "piper", "openarm", "ur5e", "xarm"] as const;
export type RobotId = (typeof ROBOT_IDS)[number];
export type SpotId = RobotId | "franka_gripper";

/** Reach (m), approximate public specs: it only sizes the stand-ins against each other. */
export const ROBOT_REACH: Record<RobotId, number> = { franka: 0.855, so101: 0.42, piper: 0.626, openarm: 0.633, ur5e: 0.85, xarm: 0.7 };

/** Larger than life, like a wreck in a forest of 30 m trunks; the same for all so they keep their proportions. */
const HEROIC = 1.6;

/** The Franka's joint limits (rad, m), from its URDF (web/public/robots/franka_description). */
export const FRANKA_LIMITS: Record<string, [number, number]> = {
  panda_joint1: [-2.8973, 2.8973],
  panda_joint2: [-1.7628, 1.7628],
  panda_joint3: [-2.8973, 2.8973],
  panda_joint4: [-3.0718, -0.0698],
  panda_joint5: [-2.8973, 2.8973],
  panda_joint6: [-0.0175, 3.7525],
  panda_joint7: [-2.8973, 2.8973],
  panda_finger_joint1: [0, 0.04],
  panda_finger_joint2: [0, 0.04],
};

export type PoseName = "lying_side" | "reaching_up" | "slumped" | "lying_back" | "stretched" | "gripper_buried";

export interface Pose {
  /** The stand-in Franka's joints. */
  joints: Record<string, number>;
  /** Euler XYZ (rad) turning the body (its URDF z-up frame, turned y-up) onto the moss. */
  lay: [number, number, number];
  /** Only this link and below (the gripper), not the whole arm. */
  only?: "hand";
}

const fingers = (w: number) => ({ panda_finger_joint1: w, panda_finger_joint2: w });

export const POSES: Record<PoseName, Pose> = {
  // Toppled over sideways, still in its working pose.
  lying_side: { joints: { panda_joint1: 0, panda_joint2: -0.25, panda_joint3: 0, panda_joint4: -1.7, panda_joint5: 0, panda_joint6: 1.55, panda_joint7: 0.8, ...fingers(0.03) }, lay: [0, 0, Math.PI / 2] },
  // Base sunk and tilted, the arm reaching up out of the moss.
  reaching_up: { joints: { panda_joint1: 0.4, panda_joint2: 0.5, panda_joint3: 0, panda_joint4: -0.9, panda_joint5: 0.3, panda_joint6: 1.9, panda_joint7: 0.4, ...fingers(0.01) }, lay: [0.6, 0, 0.3] },
  // Folded in on itself and fallen, a heap of links.
  slumped: { joints: { panda_joint1: -0.6, panda_joint2: 1.3, panda_joint3: 0.5, panda_joint4: -2.9, panda_joint5: 0.4, panda_joint6: 3.3, panda_joint7: 1.2, ...fingers(0.0) }, lay: [0, 0, 1.2] },
  // Tipped back onto its base's side, the arm along the ground.
  lying_back: { joints: { panda_joint1: 0.2, panda_joint2: -1.4, panda_joint3: 0, panda_joint4: -0.5, panda_joint5: 0, panda_joint6: 1.0, panda_joint7: 0, ...fingers(0.04) }, lay: [-1.35, 0, 0] },
  // Stretched out flat, as if it fell reaching.
  stretched: { joints: { panda_joint1: 0, panda_joint2: 1.5, panda_joint3: 0, panda_joint4: -0.2, panda_joint5: 0, panda_joint6: 1.7, panda_joint7: 0.8, ...fingers(0.02) }, lay: [0, 0, Math.PI / 2] },
  // Just the hand, fingers down, half into the moss.
  gripper_buried: { joints: { ...fingers(0.025) }, lay: [2.2, 0, 0.3], only: "hand" },
};

export interface RobotSpot {
  id: SpotId;
  pose: PoseName;
  x: number;
  z: number;
  /** Turn about the vertical (rad). */
  yaw: number;
  /** World metres per URDF metre (the stand-in Franka's), so the robot's reach matches ROBOT_REACH x HEROIC. */
  scale: number;
  /** How much of its height is under the moss (0-1). */
  sink: number;
  /** Ground radius it needs clear (m). */
  footprint: number;
}

/** Where along the walk's ground part (0 first ground point, 1 the crack) each lies, which side (+1 left of the
 *  walk's direction) and how far out (m), in its pose. Hand-chosen so the camera passes each in turn. */
const DESIGN: { id: SpotId; pose: PoseName; at: number; side: 1 | -1; off: number; yaw: number }[] = [
  { id: "franka", pose: "lying_side", at: 0.18, side: 1, off: 3.4, yaw: 0.4 },
  { id: "so101", pose: "slumped", at: 0.3, side: -1, off: 2.8, yaw: 2.1 },
  { id: "piper", pose: "reaching_up", at: 0.44, side: 1, off: 4.2, yaw: -0.8 },
  { id: "franka_gripper", pose: "gripper_buried", at: 0.55, side: -1, off: 2.6, yaw: 1.1 },
  { id: "openarm", pose: "lying_back", at: 0.66, side: -1, off: 4.4, yaw: 2.8 },
  { id: "ur5e", pose: "stretched", at: 0.78, side: 1, off: 3.8, yaw: -2.2 },
  { id: "xarm", pose: "lying_side", at: 0.9, side: -1, off: 3.2, yaw: 0.9 },
];

const SINK: Record<PoseName, number> = { lying_side: 0.3, reaching_up: 0.45, slumped: 0.35, lying_back: 0.3, stretched: 0.25, gripper_buried: 0.45 };

/** The spots, placed along the walk and nudged (outward, then along) until clear. */
export function robotSpots(walk: readonly XZ[], forest: readonly Tree[], fallen: readonly Log[]): RobotSpot[] {
  const ground = walk.slice(Math.floor(walk.length * 0.35));
  const near = (x: number, z: number) => Math.min(...walk.map(([a, b]) => Math.hypot(a - x, b - z)));
  const out: RobotSpot[] = [];
  for (const d of DESIGN) {
    const scale = d.id === "franka_gripper" ? HEROIC * 1.3 : (ROBOT_REACH[d.id] / ROBOT_REACH.franka) * HEROIC;
    const footprint = d.id === "franka_gripper" ? 0.5 : ROBOT_REACH[d.id] * scale * 0.55 + 0.2;
    const i = Math.min(ground.length - 2, Math.floor(d.at * (ground.length - 1)));
    const [ax, az] = ground[i];
    const [bx, bz] = ground[i + 1];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    const nx = -tz * d.side, nz = tx * d.side;
    const clear = (x: number, z: number) =>
      near(x, z) > 2.2 && near(x, z) < 8 && !inCrack(x, z, -1.5) &&
      forest.every((t) => Math.hypot(t.x - x, t.z - z) > t.radius + footprint) &&
      fallen.every((l) => Math.hypot(l.x - x, l.z - z) > l.length / 2 + footprint && toLog(l, x, z) > l.radius + footprint) &&
      out.every((o) => Math.hypot(o.x - x, o.z - z) > o.footprint + footprint);
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
    out.push({ id: d.id, pose: d.pose, x: placed[0], z: placed[1], yaw: d.yaw, scale, sink: SINK[d.pose], footprint });
  }
  return out;
}
