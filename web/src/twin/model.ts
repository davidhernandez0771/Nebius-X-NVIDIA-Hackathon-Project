// The twin's scene, without WebGL: the robot's files, its start pose, posing it, the table, cube and bin, and the
// stick figure drawn when the meshes don't load. Sizes are the sim's (sim_worker/scene_cfg.py), in the env frame
// (metres, z up).
import { Quaternion, Vector3, type Object3D } from "three";
import type { URDFJoint, URDFLink, URDFRobot } from "urdf-loader";
import type { QuatWxyz, Vec3 } from "./types";

const PUBLIC = (import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/");

/** The Franka's URDF and collision meshes (web/public/robots/franka_description/README.md). */
export const FRANKA = {
  urdf: `${PUBLIC}robots/franka_description/robots/panda_arm_hand.urdf`,
  packages: { franka_description: `${PUBLIC}robots/franka_description` },
  /** The links drawn in the needle colour while the gripper is closed. */
  gripperLinks: ["panda_hand", "panda_leftfinger", "panda_rightfinger"],
  hand: "panda_hand",
  /** panda_hand origin -> fingertip centre, in the hand frame (sim_worker/robots.py, franka tcp_offset). */
  tcpOffset: [0, 0, 0.1034] as Vec3,
  /** Isaac Lab's start pose (isaaclab_assets/robots/franka.py, FRANKA_PANDA_LEGACY_CFG.init_state, which
   *  FRANKA_PANDA_HIGH_PD_CFG, the sim's robot, keeps). */
  rest: {
    panda_joint1: 0.0,
    panda_joint2: -0.569,
    panda_joint3: 0.0,
    panda_joint4: -2.81,
    panda_joint5: 0.0,
    panda_joint6: 3.037,
    panda_joint7: 0.741,
    panda_finger_joint1: 0.04,
    panda_finger_joint2: 0.04,
  } as Record<string, number>,
};

// sim_worker/scene_cfg.py
export const CUBE_SIZE = 0.05;
const BIN_INNER: Vec3 = [0.2, 0.2, 0.08];
const BIN_WALL = 0.01;
export const TABLE = { size: [0.85, 1.2, 0.05] as Vec3, center: [0.575, 0.0, -0.025] as Vec3 };

export type Box = { name: string; size: Vec3; center: Vec3 };

/** The open-top bin's floor and four walls, around the bin's origin (scene_cfg.py BIN_PARTS). */
export function binParts(): Box[] {
  const [ix, iy, iz] = BIN_INNER;
  const w = BIN_WALL;
  const [ox, oy] = [ix + 2 * w, iy + 2 * w];
  const wallZ = w + iz / 2;
  return [
    { name: "floor", size: [ox, oy, w], center: [0, 0, w / 2] },
    { name: "wall_px", size: [w, oy, iz], center: [(ix + w) / 2, 0, wallZ] },
    { name: "wall_nx", size: [w, oy, iz], center: [-(ix + w) / 2, 0, wallZ] },
    { name: "wall_py", size: [ix, w, iz], center: [0, (iy + w) / 2, wallZ] },
    { name: "wall_ny", size: [ix, w, iz], center: [0, -(iy + w) / 2, wallZ] },
  ];
}

/** The cutting mat on the table top (z = 0), reaching back under the robot: a line every 5 cm, a major one every
 *  25 cm, as the page's mat is a minor line every 24 px and a major one every 120 px. */
export const MAT = { x: [-0.35, 1.0] as [number, number], y: [-0.6, 0.6] as [number, number], minor: 0.05, major: 0.25 };

export type MatLine = { a: Vec3; b: Vec3; major: boolean };

export function matLines(): MatLine[] {
  const lines: MatLine[] = [];
  const steps = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let k = Math.ceil(lo / MAT.minor - 1e-9); k * MAT.minor <= hi + 1e-9; k++) out.push(k);
    return out;
  };
  const major = (k: number) => k % Math.round(MAT.major / MAT.minor) === 0;
  for (const k of steps(...MAT.x)) lines.push({ a: [k * MAT.minor, MAT.y[0], 0], b: [k * MAT.minor, MAT.y[1], 0], major: major(k) });
  for (const k of steps(...MAT.y)) lines.push({ a: [MAT.x[0], k * MAT.minor, 0], b: [MAT.x[1], k * MAT.minor, 0], major: major(k) });
  return lines;
}

/** three.js keeps (x, y, z, w); the sim writes (w, x, y, z). */
export function quat([w, x, y, z]: QuatWxyz): Quaternion {
  return new Quaternion(x, y, z, w);
}

/** Set the joints the robot has (others are ignored). True if anything moved. */
export function applyJoints(robot: URDFRobot, joints: Record<string, number>): boolean {
  let moved = false;
  for (const [name, value] of Object.entries(joints)) {
    const joint = robot.joints[name];
    if (joint && Number.isFinite(value) && joint.setJointValue(value)) moved = true;
  }
  if (moved) robot.updateMatrixWorld(true);
  return moved;
}

/** The fingertip centre (the sim's tool point, its ee_pos) in the robot's frame. */
export function toolPoint(robot: URDFRobot, hand = FRANKA.hand, offset: Vec3 = FRANKA.tcpOffset): Vector3 {
  robot.updateMatrixWorld(true);
  const link = robot.links[hand];
  return robot.worldToLocal(link.localToWorld(new Vector3(...offset)));
}

const isJoint = (o: Object3D): o is URDFJoint => (o as URDFJoint).isURDFJoint === true;

/** The links whose parts are drawn in the needle colour while the gripper is closed. */
export function gripperLinkSet(robot: URDFRobot, names = FRANKA.gripperLinks): Set<URDFLink> {
  return new Set(names.map((n) => robot.links[n]).filter(Boolean));
}

export type BoneSegment = { link: string; to: Vector3 };

/** The stick figure, per link, in the link's own frame (so it moves with the joints): a bone from the link's origin
 *  to each child joint, and a short stub along the link's z for a leaf (a finger). Zero-length bones are dropped. */
export function boneSegments(robot: URDFRobot): BoneSegment[] {
  const out: BoneSegment[] = [];
  for (const [name, link] of Object.entries(robot.links)) {
    const kids = link.children.filter(isJoint);
    for (const j of kids) if (j.position.length() > 0.001) out.push({ link: name, to: j.position.clone() });
    if (kids.length === 0 && link !== robot) out.push({ link: name, to: new Vector3(0, 0, 0.045) });
  }
  return out;
}
