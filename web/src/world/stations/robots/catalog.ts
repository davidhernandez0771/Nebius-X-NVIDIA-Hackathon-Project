// The robots SANT tests with, as the robot wall's catalog lists them. Every field comes from the repo
// (or the robot catalog note it cites), and a field the sources don't have is left out, never guessed:
// no payload for any of them, no reach for the two arms that haven't run yet. "Tested in Isaac" means
// SANT's pick-and-place ran on it in Isaac Lab; "planned" means nothing of SANT has run on it yet.
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
  /** Where each fact comes from: repo paths, the notes, or the catalog note's upstream repos. */
  sources: readonly string[];
}

const T2 = "docs/superpowers/notes/2026-10-15-t2-status.md";
const BYOR = "docs/superpowers/notes/2026-10-18-byor-backend.md";
const CATALOG_NOTE = "robot catalog note (open robot arm catalog, 2026-10-17)";

export const CATALOG: readonly CatalogRobot[] = [
  {
    id: "franka",
    name: "Franka Panda",
    maker: "Franka Emika",
    arm: { dof: "7", reach: "≈ 0.85 m" },
    gripper: "Parallel two-finger hand; each finger slides 0–4 cm.",
    today: "SANT's main robot: record a demo, check it in physics, multiply it, train on it. The Record page's twin and the machine's hologram are this arm.",
    status: "tested",
    result: "Multiply 30/30 verified copies (seeds 100–129, 2026-10-18). A policy trained on SANT's copies: 17/40 vs 3/40 raw.",
    sources: [
      "web/public/robots/franka_description (package.xml, panda_arm_hand.urdf)",
      "sim_worker/robots.py, sim_worker/scene_cfg.py (FRANKA_PANDA_HIGH_PD_CFG)",
      `${T2} (Task 3: reach)`,
      `${BYOR} (built-in rerun, 30/30)`,
      "docs/superpowers/notes/2026-10-15-t3-status.md (sprint 7: 3/40 vs 17/40)",
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
    sources: ["sim_worker/robots.py, sim_worker/scene_cfg.py (FLEXIV_RIZON4S_GRAV_GRIPPER_CFG)", `${T2} (Task 3: second-arm trial)`],
  },
  {
    id: "openarm",
    name: "OpenArm",
    maker: "Enactic",
    arm: { dof: "7", reach: "0.44 m shoulder to wrist, + 0.19 m to the fingertips" },
    gripper: "Parallel two-finger gripper, 4.4 cm per finger.",
    today: "Runs the replay and multiply in Isaac (robot \"openarm\"), and was a test robot for Bring your robot.",
    status: "tested",
    result: "Multiply 0/30 (2026-10-16), 0/30 again through Bring your robot (2026-10-18): its ±45° wrist can't keep the gripper vertical over the table.",
    sources: ["sim_worker/robots.py, sim_worker/scene_cfg.py (OPENARM_UNI_HIGH_PD_CFG)", `${T2} (Task 5)`, BYOR, `${CATALOG_NOTE} (maker)`],
  },
  {
    id: "so101",
    name: "SO-101",
    maker: "TheRobotStudio",
    arm: { dof: "5 + jaw" },
    gripper: "One revolute jaw.",
    today: "Nothing yet. Planned through Bring your robot (its URDF, Apache-2.0); the URDF isn't on this machine yet.",
    status: "planned",
    sources: [`${CATALOG_NOTE}: github.com/TheRobotStudio/SO-ARM100`, `${BYOR} (SO-101 skipped)`],
  },
  {
    id: "piper",
    name: "PiPER",
    maker: "AgileX Robotics",
    arm: { dof: "6" },
    gripper: "Two sliding fingers.",
    today: "Nothing yet. Planned through Bring your robot (its URDF, MIT); Isaac doesn't ship it.",
    status: "planned",
    sources: [`${CATALOG_NOTE}: github.com/agilexrobotics/piper_ros`],
  },
];

const BY_ID = new Map(CATALOG.map((r) => [r.id, r]));

export function robotById(id: string): CatalogRobot {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`robots: no robot "${id}" in the catalog`);
  return r;
}

/** "DoF 7 · reach ≈ 0.85 m": the arm in one line, from the fields it has. */
export function specLine(r: CatalogRobot): string {
  return [`DoF ${r.arm.dof}`, r.arm.reach && !r.arm.reach.includes(",") ? `reach ${r.arm.reach}` : null].filter(Boolean).join(" · ");
}
