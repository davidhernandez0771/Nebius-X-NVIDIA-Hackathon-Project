// The test track's test data: an index and a run in build_test_track.py's shape.
const ROW = (over: Record<string, unknown> = {}) => ({
  id: "5350", seed: 5350, recorded: true, file: "runs/teacher-gate/5350.json", success: true, reasons: [], duration_s: 2.82,
  path_m: 1.41, peak_contact_n: 0, settle_s: 0.7, in_env: true, cube_source: "recorded", ...over,
});

/** The final test's 10 failures and their reasons, as the eval logged them (bigtest_final.episodes.jsonl). */
export const FINAL_FAILED: Record<number, string[]> = {
  5400: ["not_in_bin", "dropped"],
  5402: ["not_in_bin", "gripper_closed", "dropped"],
  5408: ["not_in_bin", "collision", "dropped"],
  5409: ["not_in_bin", "gripper_closed", "dropped"],
  5413: ["not_in_bin", "collision", "dropped"],
  5421: ["not_in_bin", "collision", "dropped"],
  5427: ["not_in_bin", "collision", "dropped"],
  5433: ["collision", "dropped"],
  5437: ["not_in_bin", "dropped"],
  5439: ["not_in_bin", "dropped"],
};

const FINAL_RUNS = Array.from({ length: 40 }, (_, i) => {
  const seed = 5400 + i;
  const failed = FINAL_FAILED[seed];
  return ROW({
    id: String(seed), seed, file: `runs/final-test-v2/${seed}.json`, in_env: null, steps: failed ? 1500 : 425,
    success: !failed, reasons: failed ?? [], ended_by: failed ? "time_limit" : "success", duration_s: failed ? 29.98 : 8.48,
  });
});

export const INDEX = {
  built: "2026-10-26T13:45:00Z",
  sources: [
    { id: "final-test-v2", title: "The final test · 30/40", what: "The camera policy that passed the pre-registered test: 40 scenes it had never seen, run once.",
      checkpoint: "C:\\dev\\pm-t6-big\\data\\experiments\\bigtest\\train\\distill_r0\\checkpoints\\180000\\pretrained_model", seeds: [5400, 5439],
      summary: { successes: 30, n: 40, ci95: [0.5981, 0.8581], judge: "SANT's check_success, as each run ran" },
      note: "The bin's spot is re-made from the scene's seed.", runs: FINAL_RUNS },
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

/** A final-test run file: the cube's rotation each step and the contact sensors' step ranges as well. */
export const FINAL_RUN = (seed: number, over: Record<string, unknown> = {}) => {
  const failed = FINAL_FAILED[seed];
  return RUN({
    demo_id: `bigtest_final_${seed}`, verified: !failed,
    cube_quat_path: [[1, 0, 0, 0], [1, 0, 0, 0], [0.7071, 0.7071, 0, 0], [0, 1, 0, 0]],
    contacts: { gripper_cube: [[1, 3]], arm_bin: failed ? [[2, 4]] : [], arm_table: [] },
    facts: { success: !failed, reasons: failed ?? [], duration_s: failed ? 29.98 : 8.48, path_m: 1.1, peak_contact_n: failed ? 113.27 : 0, settle_s: 0.84 },
    ...over,
  });
};
