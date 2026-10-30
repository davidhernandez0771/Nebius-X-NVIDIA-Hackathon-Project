// The LOOK clip's test data, in build_look_clip.py's shape: an index with two pairs and run files in the test
// track's format. The raw run is long (it ran to the time limit); v2's is short (it succeeded).
const row = (sid: "raw" | "v2", seed: number, over: Record<string, unknown> = {}) => ({
  id: String(seed), seed, recorded: true, file: `runs/${sid}/${seed}.json`, path_m: 1, peak_contact_n: 0, settle_s: 0.5, in_env: null,
  cube_source: "recorded", steps: sid === "raw" ? 20 : 8,
  ...(sid === "raw"
    ? { success: false, reasons: ["not_in_bin"], duration_s: 29.98, ended_by: "time_limit", standing: "illustrative" }
    : { success: true, reasons: [], duration_s: 7.48, ended_by: "success", standing: "counted" }),
  ...over,
});

export const CLIP = {
  built: "2026-10-27T12:00:00Z",
  caption: "Same 10 demos. Same scene. 0/40 vs 30/40.",
  label: "Illustrative replay",
  pick: "Picked: the seeds where both policies have a recorded trace, the raw-demo policy failed and v2 succeeded (2 of 4 shared seeds).",
  sides: {
    raw: { title: "Copying the 10 raw demos", what: "ACT on the raw demos", checkpoint: "C:\\x\\raw_10\\pretrained_model", headline: { successes: 0, n: 40, seeds: [5020, 5059] } },
    v2: { title: "SANT v2", what: "SANT's v2", checkpoint: "C:\\x\\180000\\pretrained_model", headline: { successes: 30, n: 40, seeds: [5400, 5439] } },
  },
  pairs: [
    { seed: 5403, raw: row("raw", 5403), v2: row("v2", 5403) },
    { seed: 5404, raw: row("raw", 5404), v2: row("v2", 5404) },
  ],
};

/** A run file: n steps at 4 Hz; the hand ends `gap` m from the cube; `touch` puts the fingers on the cube. */
export function clipRun(seed: number, n: number, { success, touch, gap = 0.2 }: { success: boolean; touch: boolean; gap?: number }) {
  const cube = Array.from({ length: n }, (_, k) => (success ? [0.5, 0.3 * (k / (n - 1)), 0.025] : [0.5, 0, 0.025]));
  const hand = cube.map(([x, y, z], k) => [x, y, z + gap + (success ? 0 : 0.1 * (1 - k / (n - 1)))]);
  return {
    demo_id: `${success ? "v2" : "raw"}_${seed}`, source: "isaac", robot: "franka", fps: 4, n_steps: n, joint_names: ["panda_joint1"],
    joint_pos: Array.from({ length: n }, (_, k) => [k / n]), gripper: Array.from({ length: n }, (_, k) => (success && k > 0 && k < n - 1 ? 1 : 0)),
    cube_pos: cube, cube_quat: [1, 0, 0, 0], bin: [0.5, 0.3, 0, 1, 0, 0, 0], base: [0, 0, 0, 1, 0, 0, 0], verified: success, lineage: null,
    cube_source: "recorded", contact_n: Array(n).fill(0), hand_pos: hand, cube_quat_path: Array(n).fill([1, 0, 0, 0]),
    contacts: { gripper_cube: touch ? [[1, n - 1]] : [], arm_bin: [], arm_table: [] },
    facts: { success, reasons: success ? [] : ["not_in_bin"], duration_s: success ? 7.48 : 29.98, path_m: 1, peak_contact_n: 0, settle_s: 0.5 },
  };
}

/** raw: 20 steps at 4 Hz (5 s), never touches the cube; v2: 8 steps (2 s), carries it to the bin. */
export const RAW_RUN = (seed: number) => clipRun(seed, 20, { success: false, touch: false });
export const V2_RUN = (seed: number) => clipRun(seed, 8, { success: true, touch: true, gap: 0 });
