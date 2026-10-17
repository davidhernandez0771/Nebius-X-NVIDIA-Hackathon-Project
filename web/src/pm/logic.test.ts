import { describe, expect, it } from "vitest";
import { framingCheck } from "./record/framing";
import { layoutTimeline, speedProfile } from "./review/timeline";
import { summarizeDemos } from "./dataset/summary";
import { chartPoints, chartRuns, parseResults } from "./results/results";
import type { Demo, Diagnosis } from "./types";

// --- Record: framing against demo_pipeline.teleop.Calibration's defaults ---------------

describe("framingCheck", () => {
  const centered = { tracking_ok: true, wrist_uv: [0.5, 0.5] as [number, number], palm_width: 0.1 };

  it("is ok for a centered hand at mid depth", () => {
    expect(framingCheck(centered)).toEqual({ state: "ok", hints: [] });
  });

  it("reports no hand when tracking is lost", () => {
    expect(framingCheck({ ...centered, tracking_ok: false }).state).toBe("no-hand");
  });

  it("gives directions in the mirrored view the user sees", () => {
    // raw u = 0.1 is the camera's left, which is the user's right in a mirror.
    expect(framingCheck({ ...centered, wrist_uv: [0.1, 0.5] }).hints).toEqual(["Move your hand left"]);
    expect(framingCheck({ ...centered, wrist_uv: [0.9, 0.5] }).hints).toEqual(["Move your hand right"]);
  });

  it("flags the top and bottom edges", () => {
    expect(framingCheck({ ...centered, wrist_uv: [0.5, 0.1] }).hints).toEqual(["Move your hand down"]);
    expect(framingCheck({ ...centered, wrist_uv: [0.5, 0.9] }).hints).toEqual(["Move your hand up"]);
  });

  it("flags a hand too far from or too near the camera", () => {
    expect(framingCheck({ ...centered, palm_width: 0.04 }).hints).toEqual(["Bring your hand closer"]);
    expect(framingCheck({ ...centered, palm_width: 0.2 }).hints).toEqual(["Move your hand back"]);
  });

  it("is at the edge, not ok, when any hint applies", () => {
    expect(framingCheck({ ...centered, wrist_uv: [0.9, 0.9] })).toEqual({
      state: "edge",
      hints: ["Move your hand right", "Move your hand up"],
    });
  });
});

// --- Review: the demo strip -------------------------------------------------------------

const diagnosis: Diagnosis = {
  segments: [
    { name: "approach", t0: 0, t1: 2 },
    { name: "grasp", t0: 2, t1: 3 },
  ],
  issues: [
    { type: "pause", t0: 1, t1: 1.5, evidence: "speed < 0.01 m/s" },
    { type: "grasp_off_center", t: 2.5, evidence: "wrist view" },
  ],
  repairs: [{ op: "remove_pause", t0: 1, t1: 1.5 }, { op: "recenter_grasp", t: 2.5 }, { op: "discard" }],
  decision: "repair",
  label: "pick the cube and place it in the bin",
};

describe("layoutTimeline", () => {
  it("places segments as percentages of the demo", () => {
    const { segments } = layoutTimeline(4, diagnosis);
    expect(segments).toEqual([
      { name: "approach", left: 0, width: 50 },
      { name: "grasp", left: 50, width: 25 },
    ]);
  });

  it("places range issues as spans and point issues as zero-width marks", () => {
    const { issues } = layoutTimeline(4, diagnosis);
    expect(issues.map((i) => [i.type, i.left, i.width])).toEqual([
      ["pause", 25, 12.5],
      ["grasp_off_center", 62.5, 0],
    ]);
  });

  it("keeps repairs that have a time and lists the rest as whole-demo", () => {
    const { repairs, wholeDemo } = layoutTimeline(4, diagnosis);
    expect(repairs.map((r) => [r.op, r.left, r.width])).toEqual([
      ["remove_pause", 25, 12.5],
      ["recenter_grasp", 62.5, 0],
    ]);
    expect(wholeDemo).toEqual(["discard"]);
  });

  it("clamps times past the end to the strip", () => {
    const late = { ...diagnosis, issues: [{ type: "drop", t0: 3, t1: 9, evidence: "" }] };
    const [issue] = layoutTimeline(4, late).issues;
    expect(issue.left).toBe(75);
    expect(issue.width).toBe(25);
  });

  it("does not divide by zero on an empty demo", () => {
    const { segments } = layoutTimeline(0, diagnosis);
    expect(segments.every((s) => s.left === 0 && s.width === 0)).toBe(true);
  });
});

describe("speedProfile", () => {
  it("is distance over time between steps, in m/s", () => {
    const traj = {
      t: [0, 1, 2],
      ee_pos: [
        [0, 0, 0],
        [3, 4, 0],
        [3, 4, 0],
      ] as Demo["trajectory"]["ee_pos"],
    };
    expect(speedProfile(traj)).toEqual({ t: [1, 2], speed: [5, 0], pathLength: 5, duration: 2 });
  });
});

// --- Dataset: counts and yields from GET /demos ----------------------------------------

function demo(id: string, source: Demo["source"], human_seconds = 0, parent_id: string | null = null): Demo {
  return {
    id,
    source,
    parent_id,
    human_seconds,
    created_at: "2026-10-16T00:00:00Z",
    trajectory: { t: [0, 1], ee_pos: [], ee_quat: [], gripper: [] },
    scene: { cube_pose: { pos: [0, 0, 0], quat_wxyz: [1, 0, 0, 0] }, bin_pose: { pos: [0, 0, 0], quat_wxyz: [1, 0, 0, 0] }, robot: "franka", seed: 0 },
  };
}

describe("summarizeDemos", () => {
  it("counts each source and totals the human minutes", () => {
    const s = summarizeDemos([
      demo("h1", "human", 90),
      demo("h2", "human", 30),
      demo("r1", "repaired", 0, "h1"),
      demo("v1", "variant", 0, "r1"),
      demo("v2", "variant", 0, "r1"),
      demo("v3", "variant", 0, "r1"),
    ]);
    expect(s.counts).toEqual({ human: 2, repaired: 1, variant: 3 });
    expect(s.humanMinutes).toBe(2);
    expect(s.total).toBe(6);
  });

  it("gives perfected-per-human and variants-per-perfected ratios", () => {
    const s = summarizeDemos([demo("h1", "human"), demo("h2", "human"), demo("r1", "repaired", 0, "h1"), demo("v1", "variant", 0, "r1"), demo("v2", "variant", 0, "r1")]);
    expect(s.perfectedPerHuman).toBe(0.5);
    expect(s.variantsPerPerfected).toBe(2);
  });

  it("leaves a ratio empty rather than dividing by zero", () => {
    const s = summarizeDemos([]);
    expect(s.perfectedPerHuman).toBeNull();
    expect(s.variantsPerPerfected).toBeNull();
  });
});

// --- Results: sample data and chart geometry -------------------------------------------

describe("parseResults", () => {
  const valid = {
    sample: true,
    demos: [5, 10, 20],
    series: [{ key: "raw", label: "Raw", success: [0.1, 0.2, 0.3] }],
    ablation: { demos: 10, bars: [{ key: "rules", label: "Rules only", success: 0.4 }] },
    multiply_yield: { ours: 0.5, mimicgen: [0.38, 0.74] },
  };

  it("accepts a well-formed file", () => {
    expect(parseResults(valid).series[0].success).toEqual([0.1, 0.2, 0.3]);
  });

  it("rejects a series whose length doesn't match the demo counts", () => {
    expect(() => parseResults({ ...valid, series: [{ key: "raw", label: "Raw", success: [0.1] }] })).toThrow(/raw/);
  });

  it("rejects success rates outside 0 to 1", () => {
    expect(() => parseResults({ ...valid, series: [{ key: "raw", label: "Raw", success: [0.1, 2, 0.3] }] })).toThrow();
  });

  it("keeps unmeasured values as null, never 0", () => {
    const r = parseResults({
      ...valid,
      sample: false,
      series: [{ key: "raw", label: "Raw", success: [0.1, null, null] }],
      ablation: { demos: 10, bars: [{ key: "rules", label: "Rules only", success: null }] },
      multiply_yield: { ours: null, mimicgen: [0.38, 0.74] },
    });
    expect(r.series[0].success).toEqual([0.1, null, null]);
    expect(r.ablation.bars[0].success).toBeNull();
    expect(r.multiply_yield.ours).toBeNull();
  });

  it("ignores extra fields such as provenance", () => {
    const r = parseResults({ ...valid, sources: { "series.raw": "evals/raw.json" } });
    expect(r.series).toHaveLength(1);
  });

  it("rejects a file that isn't an object", () => {
    expect(() => parseResults(null)).toThrow();
    expect(() => parseResults([1, 2])).toThrow();
  });

  it("treats any file without sample: false as sample data", () => {
    const { sample: _drop, ...unflagged } = valid;
    expect(parseResults(unflagged).sample).toBe(true);
  });
});

describe("chartPoints", () => {
  it("spaces demo counts evenly and maps success 0..1 bottom to top", () => {
    expect(chartPoints([0, 0.5, 1], { width: 200, height: 100, pad: 0 })).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ]);
  });

  it("leaves a gap for a pending value", () => {
    expect(chartPoints([0, null, 1], { width: 200, height: 100, pad: 0 })).toEqual([{ x: 0, y: 100 }, null, { x: 200, y: 0 }]);
  });

  it("insets by the padding", () => {
    expect(chartPoints([0, 1], { width: 120, height: 120, pad: 10 })).toEqual([
      { x: 10, y: 110 },
      { x: 110, y: 10 },
    ]);
  });
});

describe("chartRuns", () => {
  it("splits a line at pending points so nothing is drawn through them", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 1 };
    const c = { x: 3, y: 3 };
    expect(chartRuns([a, b, null, c])).toEqual([[a, b], [c]]);
    expect(chartRuns([null, null])).toEqual([]);
  });
});
