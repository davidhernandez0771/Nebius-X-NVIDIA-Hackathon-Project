import { describe, expect, it } from "vitest";
import type { Analysis, Nemotron, Sources } from "../analysis/model";
import { measured } from "../results/data";
import { CLIMB, CLIMB_FOOTNOTE, GOAL, TEACHER } from "../results/proofData";
import { analystSummary, ciText, GOAL_RATE, HEADLINE, NOT_SHOWN, pctText, PILLARS, rateCi, SELECTION_NOTES, stageASelection, teacherPath } from "./model";

describe("the pillars", () => {
  it("are the climb, in order, then the scripted-expert pair, each from the data modules", () => {
    expect(PILLARS.map((p) => `${p.k}/${p.n}`)).toEqual(["0/40", "3/40", "15/40", "30/40", "3/40", "17/40"]);
    expect(PILLARS.slice(0, 4).map((p) => p.key)).toEqual(CLIMB.map((s) => s.key));
    expect(PILLARS.map((p) => p.series)).toEqual(["climb", "climb", "climb", "climb", "scripted", "scripted"]);
    CLIMB.forEach((s, i) => {
      expect(PILLARS[i].ci).toEqual(s.ci);
      expect(PILLARS[i].seeds).toBe(s.seeds);
    });
    expect(PILLARS[4].ci).toEqual(measured("multiply", "raw_10_30k").ci);
    expect(PILLARS[5].ci).toEqual(measured("multiply", "raw_multiply_10_30k").ci);
    expect(PILLARS[4].seeds).toBe("5020–5059");
  });

  it("marks only v2 as past the goal", () => {
    expect(PILLARS.filter((p) => p.metGoal).map((p) => p.key)).toEqual(["v2"]);
  });

  it("each carries a source line", () => {
    for (const p of PILLARS) expect(p.cite).toMatch(/note, lines? \d/);
  });
});

describe("formatting", () => {
  it("gives the rate as a whole percent", () => {
    expect(pctText(30, 40)).toBe("75%");
    expect(pctText(3, 40)).toBe("8%");
    expect(pctText(0, 40)).toBe("0%");
  });

  it("gives a Wilson interval in two places or as percents", () => {
    expect(ciText([0.598, 0.858])).toBe("0.60–0.86");
    expect(ciText([0.598, 0.858], "pct")).toBe("60–86%");
    expect(ciText([0, 0.088], "pct")).toBe("0–9%");
  });

  it("reads a pillar as one sentence", () => {
    expect(rateCi(PILLARS[3])).toBe("30/40 (75%), Wilson 95% CI 0.60–0.86, seeds 5400–5439");
  });
});

describe("the headline", () => {
  it("is v2's one-shot test against the 60% goal", () => {
    expect(HEADLINE).toMatchObject({ k: 30, n: 40, pct: "75%", ci: "0.60–0.86", seeds: "5400–5439", goal: "24/40" });
    expect(GOAL_RATE).toBe(GOAL.k / GOAL.n);
    expect(GOAL_RATE).toBe(0.6);
  });
});

describe("what this does not show", () => {
  it("names one run, no ablation and different seeds, each cited", () => {
    const all = NOT_SHOWN.map((x) => x.text).join(" ");
    expect(all).toMatch(/one training seed/i);
    expect(all).toMatch(/no ablation/i);
    expect(NOT_SHOWN.some((x) => x.text === CLIMB_FOOTNOTE)).toBe(true);
    for (const x of NOT_SHOWN) expect(x.cite).toMatch(/note, lines? \d/);
  });

  it("says selection is best-of-3", () => {
    expect(SELECTION_NOTES[0].text).toMatch(/best-of-3/);
  });
});

describe("the teacher curve", () => {
  it("maps the first and last points to the plot's corners", () => {
    const d = teacherPath(TEACHER.curve.map((c) => ({ x: c.iteration, y: c.withDemos })), { w: 100, h: 50, xMax: 1499, yMax: 128 });
    expect(d.startsWith("M 20.01 50")).toBe(true);
    expect(d.endsWith("L 100 5.86")).toBe(true);
  });
});

const SOURCES: Sources = {
  live_enabled: false,
  sources: [
    { id: "bigtest_final", title: "Final", detail: "The big test's final model (Stage A, 180k steps): ...", episodes: 69, successes: 51, post_hoc: true, cached: true },
    { id: "stage_a_60k", title: "Stage A · 60k steps", detail: "", episodes: 29, successes: 13, post_hoc: false, cached: false },
    { id: "stage_a_120k", title: "Stage A · 120k steps", detail: "", episodes: 29, successes: 17, post_hoc: false, cached: false },
    { id: "stage_b_60k", title: "Stage B · 60k steps", detail: "", episodes: 29, successes: 8, post_hoc: false, cached: false },
  ],
};

function point(seed: number, success: boolean, test: boolean) {
  return { seed, success, primary: success ? null : "dropped", reasons: [], cube: [0.5, 0] as [number, number], bin: [0.5, 0.2] as [number, number], cube_yaw_deg: 0, test };
}

const NEMOTRON: Nemotron = {
  recipe: { summary: "s", regions: [{ name: "left_cube_right_bin", targets: ["dropped"], cube_x: [0, 1], cube_y: [0, 1], cube_yaw_deg: [0, 1], bin_x: [0, 1], bin_y: [0, 1], share: 0.4, rationale: "r" }], uniform_share: 0.6, fixes: [] },
  support: [{ region: "left_cube_right_bin", episodes_inside: 29, target_failures_inside: 10, target_failures_total: 17, coverage: 0.59, rate_inside: 0.34, rate_overall: 0.25, p_value: 0.0918 }],
  agreement: 0.83,
  candidates: 3,
  k: 3,
  calls: 5,
  cost_usd: 0.042488,
  model: "nvidia/nemotron-3-super-120b-a12b",
  api_errors: 0,
  attempts: [
    { sample: 0, think: true, accepted: false, errors: ["likely chance"], claimed: null, excerpt: "{" },
    { sample: 0, think: true, accepted: true, errors: [], claimed: null, excerpt: null },
    { sample: 1, think: true, accepted: true, errors: [], claimed: null, excerpt: null },
    { sample: 2, think: true, accepted: false, errors: ["the model service did not answer"], claimed: null, excerpt: null },
  ],
};

function finalAnalysis(over: Partial<Analysis> = {}): Analysis {
  const sel = Array.from({ length: 29 }, (_, i) => point(5500 + i, i < 21, false));
  const test = Array.from({ length: 40 }, (_, i) => point(5400 + i, i < 30, true));
  return {
    id: "bigtest_final",
    title: "Final",
    detail: "The big test's final model (Stage A, 180k steps): its selection on 5500-5528",
    episodes: 69,
    successes: 51,
    failures: 18,
    post_hoc: true,
    untraced: true,
    failure_counts: {},
    failure_table: [],
    points: [...test, ...sel],
    rules: null,
    nemotron: NEMOTRON,
    live_enabled: false,
    ...over,
  };
}

describe("Stage A's checkpoint selection, read from the backend", () => {
  it("is 60k and 120k from the source list, then the final model's selection episodes", () => {
    const s = stageASelection(SOURCES, finalAnalysis())!;
    expect(s.steps.map((x) => `${x.label} ${x.k}/${x.n}`)).toEqual(["60k 13/29", "120k 17/29", "180k 21/29"]);
    expect(s.picked).toBe("180k");
    expect(s.seeds).toBe("5500–5528");
  });

  it("is null when the backend gave nothing", () => {
    expect(stageASelection(null, null)).toBeNull();
    expect(stageASelection({ live_enabled: false, sources: [] }, null)).toBeNull();
  });

  it("keeps what it has when the final model is missing", () => {
    const s = stageASelection(SOURCES, null)!;
    expect(s.steps.map((x) => x.label)).toEqual(["60k", "120k"]);
  });
});

describe("the analyst strip", () => {
  it("counts claims kept and sent back, the cost, the model and the verdict", () => {
    const a = analystSummary(finalAnalysis())!;
    expect(a).toMatchObject({ episodes: 69, kept: 2, sentBack: 1, noAnswer: 1, cost: "$0.042", model: "nvidia/nemotron-3-super-120b-a12b", weak: true });
    expect(a.verdict).toBe("more scenes in left cube right bin (weak lead, one-sided p = 0.09)");
  });

  it("is null when Nemotron was not asked", () => {
    expect(analystSummary(finalAnalysis({ nemotron: null }))).toBeNull();
  });
});
