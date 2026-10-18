// The "Bring your robot" backend contract (T2: C:\dev\pm-t2\docs\design\byor-api.md). Only the fields the
// setup page reads are typed; every number in the report card is {value, source}.

export type Severity = "error" | "warning";
export type Issue = { code: string; severity: Severity; message: string; where: string | null };

export type UploadResult = {
  id: string;
  name: string;
  created: boolean;
  urdf: string;
  sha256: string;
  n_links: number;
  n_joints: number;
  issues: Issue[];
  parts: string;
};

/** `GET /robots` (newest first) and `GET /robots/{id}`: byor-api.md §2. */
export type RobotSummary = {
  id: string;
  name: string;
  uploaded_at: string;
  roles_set: boolean;
  report_status: "none" | "queued" | "running" | "done" | "failed";
  headline: { pick_place: string; reach: number | null } | null;
};

export type JointType = "revolute" | "continuous" | "prismatic" | "fixed" | "floating" | "planar";

export type PartLink = {
  name: string;
  parent_joint: string | null;
  child_joints: string[];
  has_geometry: boolean;
  has_inertial: boolean;
};

export type PartJoint = {
  name: string;
  type: JointType;
  parent: string;
  child: string;
  axis: [number, number, number];
  origin: { xyz: [number, number, number]; rpy: [number, number, number] };
  limits: { lower: number; upper: number; effort: number; velocity: number } | null;
  mimic: { joint: string; multiplier: number; offset: number } | null;
};

export type RoleSet = {
  base: string | null;
  arm_joints: string[];
  hand: string | null;
  gripper_joints: string[];
};

export type Sourced<T> = { value: T; source: string };

export type Parts = {
  id: string;
  name: string;
  root: string;
  links: PartLink[];
  joints: PartJoint[];
  suggested_roles: { base: string | null; arm_joints: string[] | null; hand: string | null; gripper_joints: string[] | null };
  why: Partial<Record<"base" | "arm_joints" | "hand" | "gripper_joints", string>>;
  derived: {
    dof: number;
    reach_m: Sourced<number>;
    tcp: { link: string; offset: number[]; approach_axis: number[]; source: string };
    gripper: { open: number; closed: number; source: string };
  } | null;
  issues: Issue[];
};

export type RolesBody = RoleSet & {
  tcp_offset?: number[] | null;
  gripper_open?: number | Record<string, number> | null;
  gripper_closed?: number | Record<string, number> | null;
  mount?: { pos: [number, number, number] };
  start_joint_pos?: Record<string, number> | null;
};

export type RolesResult = {
  roles: RolesBody;
  spec: Record<string, unknown> & { sources?: Record<string, string> };
  issues: Issue[];
  ready: boolean;
};

export type EvaluateResult = { job_id: string; status: string; poll: string; report: string };

export type ReportStatus = "none" | "queued" | "running" | "done" | "failed";
export type Stage = "convert" | "reach_map" | "pick_place";

export type ReachLayer = { name: "grasp" | "release" | "carry" | string; z: number; yaw_deg: number; reachable: boolean[][]; fraction?: number };

export type SceneRow = {
  seed: number;
  success: boolean;
  reasons: string[];
  cube: [number, number];
  bin: [number, number];
  tracking_mean_mm: number | null;
  limit_hits: string[];
};

export type LimitHit = { joint: string; limit: "lower" | "upper"; value?: number; scenes: number; steps: number };

export type ReportCard = {
  schema: string;
  robot: { id: string; name: string; urdf_sha256: string; dof: number };
  roles: RolesBody;
  task: { name: string; text: string; seeds: [number, number]; source: string; workspace: Record<string, [number, number]> };
  verdict: Sourced<"ready" | "partial" | "not_ready">;
  pick_place: {
    successes: Sourced<number> & { of: number };
    failure_reasons: Sourced<Record<string, number>>;
    tracking_mean_mm: Sourced<number | null>;
  };
  reach_map: {
    fraction: Sourced<number>;
    grid: { x: number[]; y: number[] };
    layers: ReachLayer[];
    source: string;
  };
  joint_limit_hits: Sourced<LimitHit[]>;
  scenes: { source: string; rows: SceneRow[] };
  provenance: Record<string, unknown>;
};

export type ReportResponse = {
  status: ReportStatus;
  progress: { stage: Stage; done: number; total: number } | null;
  report: ReportCard | null;
  error: string | null;
};

/** A 4xx from /robots: `{"detail": {"errors": [...]}}`, or the network/backend being down. */
export class ByorError extends Error {
  constructor(
    readonly status: number,
    readonly errors: Issue[],
  ) {
    super(errors.map((e) => e.message).join("; ") || `HTTP ${status}`);
  }
}
