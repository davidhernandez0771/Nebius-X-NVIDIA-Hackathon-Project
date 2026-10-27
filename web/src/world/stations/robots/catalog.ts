// The robots SANT tests with, as the robot wall's catalog lists them. Every field comes from the repo
// (or the robot catalog note it cites), and a field the sources don't have is left out, never guessed:
// no payload for any of them (none of their repos states one). DoF, reach and joint limits come from each
// robot's own URDF chain where its description was downloaded (specs.json, written by
// scripts/robot_asset_manifest.py from C:/dev/assets/robots); the Flexiv's stay the notes'. "Tested in Isaac"
// means SANT's pick-and-place ran on it in Isaac Lab; "planned" means nothing of SANT has run on it yet.
import specs from "./specs.json";

export type RobotStatus = "tested" | "planned";

export const STATUS_LABEL: Record<RobotStatus, string> = { tested: "Tested in Isaac", planned: "Planned" };

export interface CatalogRobot {
  id: string;
  name: string;
  maker?: string;
  arm: {
    /** Joints, as the sources count them ("5 + jaw" for the SO-101). */
    dof: string;
    reach?: string;
  };
  gripper?: string;
  /** What it does in SANT today. */
  today: string;
  status: RobotStatus;
  /** The measured outcome in Isaac (tested robots only). */
  result?: string;
  /** The arm joints' ranges, from its URDF chain (none when its description wasn't downloaded). */
  limits?: readonly { joint: string; range: string }[];
  /** What stands for it on the robot wall: its maker's meshes (repo, commit, licence) or a stand-in. */
  model: string;
  /** Where each fact comes from: repo paths, the notes, or the catalog note's upstream repos. */
  sources: readonly string[];
}

type Spec = (typeof specs)[keyof typeof specs];

const deg = (rad: number) => `${Math.round((rad * 180) / Math.PI)}°`;

/** What a robot's URDF chain gives the catalog: the reach, each arm joint's range, and the source line. */
function fromUrdf(spec: Spec) {
  return {
    reach: `${spec.reach_m.toFixed(2)} m`,
    limits: spec.joints.map((j) => ({ joint: j.name, range: `${deg(j.lower)} to ${deg(j.upper)}` })),
    source: `${spec.repo}@${spec.commit} (${spec.licence}): DoF, reach (${spec.reach_definition}) and joint limits from its URDF chain`,
  };
}

const URDF = { franka: fromUrdf(specs.franka), so101: fromUrdf(specs.so101), piper: fromUrdf(specs.piper), openarm: fromUrdf(specs.openarm) };

/** Licence caveats from C:/dev/assets/robots/SOURCES.md. */
const LICENCE_NOTE: Partial<Record<keyof typeof specs, string>> = { piper: " (its package.xml says BSD)" };

/**
 * The robot wall's model of a robot: its maker's published meshes from its description repo, reduced
 * and posed in Blender (docs/design/blender/robots.blend; web/public/world/models/robots).
 */
function modelLine(id: keyof typeof specs): string {
  const s = specs[id];
  return `Its maker's published meshes: ${s.repo}@${s.commit}, ${s.licence}${LICENCE_NOTE[id] ?? ""}.`;
}

const T2 = "docs/superpowers/notes/2026-10-15-t2-status.md";
const BYOR = "docs/superpowers/notes/2026-10-18-byor-backend.md";
const CATALOG_NOTE = "robot catalog note (open robot arm catalog, 2026-10-17)";

export const CATALOG: readonly CatalogRobot[] = [
  {
    id: "franka",
    name: "Franka Panda",
    maker: "Franka Emika",
    arm: { dof: "7", reach: URDF.franka.reach },
    limits: URDF.franka.limits,
    gripper: "Parallel two-finger hand; each finger slides 0–4 cm.",
    today: "SANT's main robot: record a demo, check it in physics, multiply it, train on it. The Record page's twin and the machine's hologram are this arm.",
    status: "tested",
    result:
      "A camera policy from 10 human mouse demos: 30/40 on unseen scenes, pre-registered and run once (2026-10-24). Multiply 30/30 verified copies (seeds 100–129, 2026-10-18). Earlier, with scripted demos: 17/40 vs 3/40 raw.",
    model: modelLine("franka"),
    sources: [
      "web/public/robots/franka_description (package.xml, panda_arm_hand.urdf)",
      "sim_worker/robots.py, sim_worker/scene_cfg.py (FRANKA_PANDA_HIGH_PD_CFG)",
      `${T2} (Task 3: reach ≈ 0.85 m, which the chain agrees with)`,
      URDF.franka.source,
      `${BYOR} (built-in rerun, 30/30)`,
      "docs/superpowers/notes/2026-10-15-t3-status.md (sprint 7: 3/40 vs 17/40)",
      "docs/superpowers/notes/2026-10-23-bigtest-prereg.md on pm/live-13 (line 744: 30/40, the one-shot test)",
    ],
  },
  {
    id: "flexiv",
    name: "Flexiv Rizon 4s",
    maker: "Flexiv",
    arm: { dof: "7", reach: "0.78 m" },
    gripper: "Grav adaptive gripper: one driven finger joint; five knuckle joints follow it.",
    today: "Runs SANT's pick-and-place replay and multiply in Isaac (robot \"flexiv\").",
    status: "tested",
    result: "Multiply 9/30, scripted 5/30 (2026-10-16). It loses the grip (slip, drag), not the reach. Not re-run since the handover fix.",
    model: "A simple stand-in: its meshes aren't among the downloaded descriptions (C:/dev/assets/robots/SOURCES.md), so the shape only suggests the arm.",
    sources: ["sim_worker/robots.py, sim_worker/scene_cfg.py (FLEXIV_RIZON4S_GRAV_GRIPPER_CFG)", `${T2} (Task 3: second-arm trial)`],
  },
  {
    id: "openarm",
    name: "OpenArm",
    maker: "Enactic",
    arm: { dof: "7", reach: URDF.openarm.reach },
    limits: URDF.openarm.limits,
    gripper: "Parallel two-finger gripper, 4.4 cm per finger.",
    today: "Runs the replay and multiply in Isaac (robot \"openarm\"), and was a test robot for Bring your robot.",
    status: "tested",
    result: "Multiply 0/30 (2026-10-16), 0/30 again through Bring your robot (2026-10-18): its ±45° wrist can't keep the gripper vertical over the table.",
    model: modelLine("openarm"),
    sources: ["sim_worker/robots.py, sim_worker/scene_cfg.py (OPENARM_UNI_HIGH_PD_CFG)", `${T2} (Task 5: shoulder to wrist <= 0.44 m)`, BYOR,
      `${CATALOG_NOTE} (maker)`, URDF.openarm.source],
  },
  {
    id: "so101",
    name: "SO-101",
    maker: "TheRobotStudio",
    arm: { dof: "5 + jaw", reach: URDF.so101.reach },
    limits: URDF.so101.limits,
    gripper: "One revolute jaw.",
    today: "Nothing yet. Planned through Bring your robot (its URDF, Apache-2.0); the URDF and meshes are downloaded, not imported yet.",
    status: "planned",
    model: modelLine("so101"),
    sources: [`${CATALOG_NOTE}: github.com/TheRobotStudio/SO-ARM100`, `${BYOR} (SO-101 skipped)`, URDF.so101.source],
  },
  {
    id: "piper",
    name: "PiPER",
    maker: "AgileX Robotics",
    arm: { dof: "6", reach: URDF.piper.reach },
    limits: URDF.piper.limits,
    gripper: "Two sliding fingers.",
    today: "Nothing yet. Planned through Bring your robot (its URDF, MIT); Isaac doesn't ship it.",
    status: "planned",
    model: modelLine("piper"),
    sources: [`${CATALOG_NOTE}: github.com/agilexrobotics/piper_ros`, URDF.piper.source],
  },
];

/** An arm on the wall that SANT hasn't run (the right wall's middle shelf): no status, only what its URDF gives. */
export interface WallOnlyRobot {
  id: string;
  name: string;
  /** "DoF 6 · reach 0.97 m", from its URDF chain (specs.json). */
  spec: string;
  model: string;
}

export const WALL_ONLY: readonly WallOnlyRobot[] = (["fr3", "ur5e", "xarm6"] as const).map((id) => ({
  id,
  name: specs[id].label,
  spec: `DoF ${specs[id].dof} · reach ${specs[id].reach_m.toFixed(2)} m`,
  model: modelLine(id),
}));

const BY_ID = new Map(CATALOG.map((r) => [r.id, r]));

export function robotById(id: string): CatalogRobot {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`robots: no robot "${id}" in the catalog`);
  return r;
}

/** "DoF 7 · reach 0.86 m": the arm in one line, from the fields it has. */
export function specLine(r: CatalogRobot): string {
  return [`DoF ${r.arm.dof}`, r.arm.reach ? `reach ${r.arm.reach}` : null].filter(Boolean).join(" · ");
}
