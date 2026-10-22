// The test track's test data: an index and a run in build_test_track.py's shape.
const ROW = (over: Record<string, unknown> = {}) => ({
  id: "5350", seed: 5350, recorded: true, file: "runs/teacher-gate/5350.json", success: true, reasons: [], duration_s: 2.82,
  path_m: 1.41, peak_contact_n: 0, settle_s: 0.7, in_env: true, cube_source: "recorded", ...over,
});

export const INDEX = {
  built: "2026-10-21T21:18:00Z",
  sources: [
    { id: "teacher-gate", title: "Teacher · gate 2", what: "50 fresh scenes", checkpoint: "data\\rl\\model_2098.pt", seeds: [5350, 5351],
      summary: { successes: 2, n: 2, ci95: [0.9287, 1.0], judge: "SANT replay" }, runs: [ROW(), ROW({ id: "5351", seed: 5351, file: "runs/teacher-gate/5351.json" })] },
    { id: "distill-r0", title: "Distillation · round 0", what: "round 0", checkpoint: null, seeds: [4000, 4022],
      summary: { successes: 1, n: 2, ci95: [0.09, 0.91], judge: "SANT check in the rollout" },
      runs: [ROW({ id: "4000", seed: 4000, file: "runs/distill-r0/4000.json", in_env: null, cube_source: "estimated" }),
        ROW({ id: "4022", seed: 4022, recorded: false, file: null, success: false, reasons: ["dropped"], duration_s: null, path_m: null, peak_contact_n: null, settle_s: null, in_env: null, cube_source: null, ended_by: "time_limit", steps: 1500 })],
      cube_estimate: { episodes: 82, held_median_mm: 13.9, held_p95_mm: 24.5, landed_median_mm: 28.0, landed_max_mm: 61.0 } },
  ],
};

export const RUN = (over: Record<string, unknown> = {}) => ({
  demo_id: "teacher_5350", source: "isaac", robot: "franka", fps: 50, n_steps: 4, joint_names: ["panda_joint1"], joint_pos: [[0], [0.1], [0.2], [0.3]],
  gripper: [0, 1, 1, 0], cube_pos: [[0.5, 0, 0.025], [0.5, 0, 0.03], [0.5, 0.1, 0.1], [0.5, 0.3, 0.035]], cube_quat: [1, 0, 0, 0],
  bin: [0.5, 0.3, 0, 1, 0, 0, 0], base: [0, 0, 0, 1, 0, 0, 0], verified: null, lineage: null, cube_source: "recorded", contact_n: [0, 0, 1.5, 0],
  hand_pos: [[0.5, 0, 0.04], [0.5, 0, 0.05], [0.5, 0.1, 0.12], [0.5, 0.3, 0.06]],
  facts: { success: true, reasons: [], duration_s: 2.82, path_m: 1.41, peak_contact_n: 1.5, settle_s: 0.7 }, ...over,
});
