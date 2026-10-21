// JSON shapes from src/demo_pipeline/schemas.py (spec section 7), as the
// backend serializes them. Field names match the pydantic models exactly.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // (w, x, y, z)
export type DemoSource = "human" | "repaired" | "variant";

export interface Trajectory {
  t: number[];
  ee_pos: Vec3[];
  ee_quat: Quat[];
  gripper: (0 | 1)[];
}

export interface Pose {
  pos: Vec3;
  quat_wxyz: Quat;
}

export interface Scene {
  cube_pose: Pose;
  bin_pose: Pose;
  robot: string;
  seed: number;
}

export interface Demo {
  id: string;
  source: DemoSource;
  parent_id: string | null;
  trajectory: Trajectory; // teleop: the pose the arm reached
  commanded?: Trajectory | null; // teleop only: the hand targets the arm lagged (diagnostics)
  scene: Scene;
  created_at: string;
  human_seconds: number;
}

export type SegmentName = "approach" | "grasp" | "lift" | "carry" | "release" | "retreat";

export interface Segment {
  name: SegmentName;
  t0: number;
  t1: number;
}

export interface Issue {
  type: string;
  evidence: string;
  t?: number | null;
  t0?: number | null;
  t1?: number | null;
}

export interface RepairOp {
  op: string;
  t?: number;
  t0?: number;
  t1?: number;
  [param: string]: unknown;
}

export interface Diagnosis {
  segments: Segment[];
  issues: Issue[];
  repairs: RepairOp[];
  decision: "repair" | "discard" | "keep";
  label: string;
}

/** GET /demos/{id}/diagnosis */
export interface StoredDiagnosis {
  source: "nemotron" | "rules";
  model_id: string | null;
  diagnosis: Diagnosis;
  gated: string[];
}

/** The Review card's Nemotron verdict, the contract in docs/design/nemotron-judge.md (on pm/nemotron-judge). */
export type StepName = "reach" | "grasp" | "carry" | "release";
export interface ReviewVerdict {
  physics: { status: "verified" | "failed"; reasons: string[] };
  label: {
    status: "ok" | "unavailable";
    task: string | null;
    object: { name: string; color: string | null } | null;
    destination: "bin" | "table" | "unknown" | null;
    steps: { name: StepName; frames: [number, number] }[];
    error: string | null;
  };
  match: {
    status: "yes" | "no" | "not_checked" | "unavailable";
    checks: { same_object: boolean; same_goal: boolean; same_order: boolean; copy_completes: boolean } | null;
    reason: string | null;
  };
  conflict: string | null;
}

/** GET /demos/{id}/review (src/app/routers/review.py) */
export interface DemoReview {
  demo_id: string;
  lineage: string[] | null;
  physics: {
    status: "verified" | "failed" | "unknown";
    source: "passport" | "episode_passport" | "success_check" | null;
    reasons: string[];
    duration: number | null;
    path_length: number | null;
    max_contact_force: number | null;
    settle_time: number | null;
    detail: string | null;
  };
  fixes: {
    source: "passport" | null;
    diagnosis_source: "nemotron" | "rules" | "hybrid" | "none" | null;
    model_id: string | null;
    applied_to: string | null;
    applied_at: string | null;
    applied: RepairOp[];
  };
  verdict: ReviewVerdict | null;
  verdict_source: string | null;
  warnings: string[];
}

/** GET /demos/{id}/take-review (src/demo_pipeline/take_review.py): the Record page's coach right after a take. */
export interface TakeReview {
  demo_id: string;
  verdict: "PASS" | "FAIL";
  lines: string[];
  source: "rules" | "nemotron";
  rejected: string | null; // why Nemotron's phrasing wasn't used
  facts: {
    success: boolean;
    reasons: string[];
    duration_s: number;
    peak_force_n: number;
    peak_force_t: number | null;
    peak_force_against: "bin" | "table" | null;
    soft_floor: boolean | null;
    soft_floor_steps: number;
    soft_floor_s: number; // held time, one decimal
    soft_floor_dips: number | null; // separate holds; null on takes from before the sim counted them
    grabs: { t: number; offset_mm: number; caught: boolean }[];
    releases: { t: number; over_rim_mm: number; over_bin: boolean }[];
    regrasps: number;
    input: string | null;
  };
}

/** demo_pipeline.scene_plan.ScenePlan as JSON (the scene picker's plans). */
export interface ScenePlanJson {
  version: 1;
  robot: string;
  objects: (
    | { id: string; kind: "cube"; color: string; size: number; pose: { x: number; y: number; yaw_deg: number } | null; on: string | null }
    | { id: string; kind: "bin"; color: string; inner: [number, number, number]; pose: { x: number; y: number; yaw_deg: number } }
  )[];
  goals: { object: string; bin: string }[];
  reach: { x: [number, number]; y: [number, number]; z_max: number } | null;
}

/** GET /scenes entries (demo_pipeline.scene_library.SceneEntry). */
export interface SceneEntry {
  id: string;
  name: string;
  description: string;
  source: "standard" | "protocol" | "nemotron" | "saved";
  plan: ScenePlanJson;
  hash: string;
  needs_settle: boolean;
  settle: { ok: boolean; errors: string[]; hash: string; at: string } | null;
  created_at: string;
}

/** POST /scenes/create: Nemotron's plan for a sentence, or why it couldn't make a valid one. */
export interface SceneDraft {
  ok: boolean;
  plan: ScenePlanJson | null;
  errors: string[];
  needs_settle: boolean | null;
  calls: number;
  model: string | null;
}
