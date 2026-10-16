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
