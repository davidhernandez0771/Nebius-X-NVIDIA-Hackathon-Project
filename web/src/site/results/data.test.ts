import { describe, expect, it } from "vitest";
import raw from "./results.json";
import { RESULTS, formatP, formatPct, parseResults } from "./data";
import { wilson } from "./stats";

const pct1 = (x: number) => Math.round(x * 1000) / 10;

describe("results.json", () => {
  it("parses", () => {
    expect(RESULTS.experiments.map((e) => e.id)).toEqual(["multiply", "copies", "grasp_fix", "nemotron", "byor", "human_demos", "grasp_fix_run2"]);
  });

  it("holds the measured results the notes report", () => {
    const k = (id: string) =>
      Object.fromEntries(RESULTS.experiments.find((e) => e.id === id)!.groups.flatMap((g) => g.arms).map((a) => [a.key, a.k === null ? null : `${a.k}/${a.n}`]));
    expect(k("multiply")).toEqual({ raw_10_30k: "3/40", raw_multiply_10_30k: "17/40", raw_multiply_10x30: "16/40" });
    expect(k("grasp_fix")).toEqual({ centered_10x10: "20/40", raw_multiply_10_30k: "17/40" });
    expect(k("nemotron")).toEqual({ labeler_nemotron: "40/40", labeler_code: "39/40", judge_nemotron: "59/60", judge_code: "60/60" });
    expect(k("byor")).toEqual({ franka: "30/30", openarm: "0/30" });
  });

  it("prints every CI as the Wilson CI of its count", () => {
    for (const a of RESULTS.experiments.flatMap((e) => e.groups.flatMap((g) => g.arms)))
      if (a.k !== null && a.ci) expect(a.ci.map(pct1), a.key).toEqual(wilson(a.k, a.n).map(pct1));
  });

  it("keeps everything not run as pending: null counts and p, and a reason", () => {
    const pending = RESULTS.experiments.filter((e) => e.pending);
    expect(pending.map((e) => e.id)).toEqual(["human_demos", "grasp_fix_run2"]);
    for (const e of pending) {
      expect(e.finding).toBeNull();
      expect(e.groups[0].comparisons.every((c) => c.p === null)).toBe(true);
      expect(e.groups[0].arms.some((a) => a.k === null)).toBe(true);
    }
  });

  it("cites a note for every measured arm and p", () => {
    for (const e of RESULTS.experiments) {
      expect(e.sources.length, e.id).toBeGreaterThan(0);
      for (const g of e.groups) {
        for (const a of g.arms) if (a.k !== null) expect(a.source, `${e.id}.${a.key}`).not.toBeNull();
        for (const c of g.comparisons) if (c.p !== null) expect(c.source, `${e.id} ${c.a} vs ${c.b}`).not.toBeNull();
      }
    }
  });
});

describe("parseResults", () => {
  const withArms = (arms: unknown[], comparisons: unknown[] = []) => ({
    ...raw,
    experiments: [{ ...raw.experiments[0], groups: [{ label: "G", arms, comparisons }] }],
  });
  const arm = (k: number | null, extra = {}) => ({ key: "a", label: "A", k, n: 40, source: { note: "t3", lines: "1" }, ...extra });

  it("rejects a count above n or below 0", () => {
    expect(() => parseResults(withArms([arm(41)]))).toThrow(/arm a/);
    expect(() => parseResults(withArms([arm(-1)]))).toThrow(/arm a/);
  });

  it("rejects a measured arm without a source, or a source in an unknown note", () => {
    expect(() => parseResults(withArms([{ ...arm(3), source: undefined }]))).toThrow(/no source/);
    expect(() => parseResults(withArms([arm(3, { source: { note: "zz", lines: "1" } })]))).toThrow(/zz/);
  });

  it("rejects outcomes that don't add up to the count", () => {
    expect(() => parseResults(withArms([arm(3, { outcomes: "1".repeat(40) })]))).toThrow(/outcomes/);
  });

  it("rejects a comparison naming an arm the group doesn't have, or a p outside 0 to 1", () => {
    expect(() => parseResults(withArms([arm(3)], [{ a: "a", b: "zz", p: 0.5 }]))).toThrow(/zz/);
    expect(() => parseResults(withArms([arm(3), { ...arm(4), key: "b" }], [{ a: "a", b: "b", p: 2 }]))).toThrow(/p must/);
  });

  it("keeps a pending count and p as null, never 0", () => {
    const r = parseResults(withArms([arm(null, { source: undefined }), { ...arm(4), key: "b" }], [{ a: "a", b: "b", p: null }]));
    expect(r.experiments[0].groups[0].arms[0].k).toBeNull();
    expect(r.experiments[0].groups[0].comparisons[0].p).toBeNull();
  });
});

describe("formatting", () => {
  it("prints p and rates the way the notes do", () => {
    expect([0.0005, 0.0012, 0.65, 1].map(formatP)).toEqual(["0.0005", "0.0012", "0.65", "1.0"]);
    expect([3 / 40, 17 / 40, 16 / 40, 59 / 60, 1].map(formatPct)).toEqual(["7.5%", "42.5%", "40%", "98.3%", "100%"]);
  });
});
