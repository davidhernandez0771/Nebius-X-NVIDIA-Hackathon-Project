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
  trajectory: Trajectory;
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
