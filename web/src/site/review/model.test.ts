import { describe, expect, it } from "vitest";
import type { Diagnosis, StoredDiagnosis } from "../../pm/types";
import { activeIssues, buildIssueRows, detectionTag, fixedSummary, formatSpan, morphAt, scramble, verdictOf } from "./model";

// s1_0002's rules diagnosis, as stored (C:\dev\pm-t4\data\demos\s1_0002_rules\diagnosis.json), times rounded.
const diagnosis: Diagnosis = {
  segments: [
    { t0: 0, t1: 2, name: "approach" },
    { t0: 2, t1: 11.68, name: "carry" },
    { t0: 11.68, t1: 13.76, name: "retreat" },
  ],
  issues: [
    { type: "idle_start_end", evidence: "still for the first 0.82 s", t: null, t0: 0, t1: 0.82 },
    { type: "jitter", evidence: "jerk_rms above 20 m/s^3 over [0.00, 13.76] s", t: null, t0: 0, t1: 13.76 },
    { type: "pause", evidence: "speed < 0.01 m/s for 2.02 s", t: null, t0: 4.5, t1: 6.52 },
    { type: "pause", evidence: "speed < 0.01 m/s for 1.60 s", t: null, t0: 8.98, t1: 10.58 },
  ],
  repairs: [
    { t0: 0.82, t1: 13.76, op: "trim" },
    { t0: 4.5, t1: 6.52, op: "remove_pause" },
    { t0: 8.98, t1: 10.58, op: "remove_pause" },
    { t0: 0, t1: 13.76, op: "smooth", strength: "med" },
  ],
  decision: "repair",
  label: "pick up the red cube and place it in the blue bin",
};
const stored: StoredDiagnosis = { source: "rules", model_id: null, diagnosis, gated: [] };

describe("buildIssueRows", () => {
  it("pairs every issue with the fix that answers it", () => {
    const rows = buildIssueRows(stored);
    expect(rows.map((r) => [r.type, r.fixes.map((f) => f.op)])).toEqual([
      ["idle_start_end", ["trim"]],
      ["jitter", ["smooth"]],
      ["pause", ["remove_pause"]],
      ["pause", ["remove_pause"]],
    ]);
  });

  it("gives each pause its own remove_pause, by time", () => {
    const [, , first, second] = buildIssueRows(stored);
    expect(first.fixes[0].t0).toBe(4.5);
    expect(second.fixes[0].t0).toBe(8.98);
  });

  it("keeps gated claims as struck rows, and fixes that answer no issue as their own rows", () => {
    const rows = buildIssueRows({
      ...stored,
      diagnosis: { ...diagnosis, issues: [], repairs: [{ op: "discard" }] },
      gated: ["grasp_off_center: measured offset 2 mm"],
    });
    expect(rows).toEqual([
      expect.objectContaining({ kind: "gated", evidence: "grasp_off_center: measured offset 2 mm", fixes: [] }),
      expect.objectContaining({ kind: "fix-only", type: "discard", fixes: [{ op: "discard" }] }),
    ]);
  });
});

describe("detectionTag", () => {
  it("labels a box from the issue's own type and measured span, never a made-up number", () => {
    expect(detectionTag({ type: "pause", t0: 4.5, t1: 6.52 })).toBe("PAUSE 2.02 s");
    expect(detectionTag({ type: "idle_start_end", t0: 0, t1: 0.82 })).toBe("IDLE 0.82 s");
    expect(detectionTag({ type: "jitter", t0: 0, t1: 13.76 })).toBe("JITTER");
    expect(detectionTag({ type: "grasp_off_center", t: 2.1 })).toBe("GRIP OFF-CENTER");
    expect(detectionTag({ type: "something_new" })).toBe("SOMETHING NEW");
  });
});

describe("formatSpan", () => {
  it("prints a range, a point or the whole demo", () => {
    expect(formatSpan({ t0: 4.5, t1: 6.52 })).toBe("4.50–6.52 s");
    expect(formatSpan({ t: 2.1 })).toBe("at 2.10 s");
    expect(formatSpan({})).toBe("whole demo");
  });
});

describe("activeIssues", () => {
  it("finds the issues under the playhead, skipping whole-demo ones", () => {
    const rows = buildIssueRows(stored);
    expect(activeIssues(rows, 5, 13.76).map((r) => r.index)).toEqual([2]);
    expect(activeIssues(rows, 0.3, 13.76).map((r) => r.index)).toEqual([0]);
    expect(activeIssues(rows, 3, 13.76)).toEqual([]);
  });
});

describe("verdictOf", () => {
  it("reports physics only from a real verification", () => {
    const v = verdictOf({ stored, verification: { success: true, reasons: [], duration: 9.32, path_length: 1.0955 } });
    expect(v.physics).toEqual({ state: "verified", duration: 9.32, pathLength: 1.0955, reasons: [] });
    expect(verdictOf({ stored, verification: null }).physics).toEqual({ state: "unknown" });
    expect(
      verdictOf({ stored, verification: { success: false, reasons: ["dropped"], duration: 7, path_length: 1 } }).physics,
    ).toEqual({ state: "failed", duration: 7, pathLength: 1, reasons: ["dropped"] });
  });

  it("names who wrote the label, and never claims the intent check ran", () => {
    const rules = verdictOf({ stored, verification: null });
    expect(rules.label).toEqual({ text: "pick up the red cube and place it in the blue bin", author: "rules template" });
    expect(rules.matches).toBe("not-checked");
    const nem = verdictOf({ stored: { ...stored, source: "nemotron", model_id: "nvidia/Nemotron-3.5-Super-VL" }, verification: null });
    expect(nem.label?.author).toBe("nvidia/Nemotron-3.5-Super-VL");
    expect(verdictOf({ stored: null, verification: null }).label).toBeNull();
  });
});

describe("fixedSummary", () => {
  it("counts issues and fixes from the diagnosis", () => {
    expect(fixedSummary(buildIssueRows(stored))).toEqual({ issues: 4, fixes: 4, gated: 0 });
  });
});

describe("morphAt", () => {
  it("pixelates up, swaps the frame at the midpoint, then resolves", () => {
    expect(morphAt(0)).toEqual({ block: 1, showAfter: false, glitch: 0 });
    expect(morphAt(0.5).showAfter).toBe(true);
    expect(morphAt(0.49).showAfter).toBe(false);
    expect(morphAt(0.5).block).toBeGreaterThan(morphAt(0.2).block);
    expect(morphAt(1)).toEqual({ block: 1, showAfter: true, glitch: 0 });
    expect(morphAt(-1)).toEqual(morphAt(0));
    expect(morphAt(2)).toEqual(morphAt(1));
  });
});

describe("scramble", () => {
  it("settles left to right and keeps spaces", () => {
    expect(scramble("13.76 s", 1, () => 0)).toBe("13.76 s");
    const half = scramble("ABCDEF GH", 0.5, () => 0);
    expect(half.slice(0, 4)).toBe("ABCD");
    expect(half[6]).toBe(" ");
    expect(half).toHaveLength(9);
  });
});
