import { describe, expect, it } from "vitest";
import { CLIMB, CLIMB_FOOTNOTE_SHORT, CLIMB_FOOTNOTE_SOURCE, DID_NOT_WORK, GOAL, PROOF_NOTES, TEACHER, TEACHER_GATE, V2_FAILURES, proofCite, proofNoteUrl } from "./proofData";
import { wilson } from "./stats";

/** The Wilson bounds the notes print are rounded to 3 places: each must be within 0.001 of a computed one. */
function expectWilson(k: number, n: number, ci: [number, number]) {
  const [lo, hi] = wilson(k, n);
  expect(Math.abs(ci[0] - lo)).toBeLessThanOrEqual(0.001);
  expect(Math.abs(ci[1] - hi)).toBeLessThanOrEqual(0.001);
}

describe("the climb", () => {
  it("has the four pre-registered one-shot tests, in order, each out of 40", () => {
    expect(CLIMB.map((s) => `${s.k}/${s.n}`)).toEqual(["0/40", "3/40", "15/40", "30/40"]);
    expect(CLIMB.map((s) => s.key)).toEqual(["raw", "sant", "v1", "v2"]);
  });

  it("carries the CIs exactly as the notes print them, and each is a real Wilson 95% interval", () => {
    expect(CLIMB.map((s) => s.ci)).toEqual([
      [0.0, 0.088],
      [0.026, 0.199],
      [0.242, 0.53],
      [0.598, 0.858],
    ]);
    for (const s of CLIMB) expectWilson(s.k, s.n, s.ci);
  });

  it("puts v2 on its own fresh seeds and the others on 5020–5059", () => {
    expect(CLIMB.map((s) => s.seeds)).toEqual(["5020–5059", "5020–5059", "5020–5059", "5400–5439"]);
  });

  it("draws the goal at 24/40, 60%, which only v2 meets", () => {
    expect(GOAL.k / GOAL.n).toBe(0.6);
    expect(CLIMB.filter((s) => s.k >= GOAL.k).map((s) => s.key)).toEqual(["v2"]);
  });
});

describe("the teacher side", () => {
  it("has home-start success out of 128 at the five matched iterations", () => {
    expect(TEACHER.n).toBe(128);
    expect(TEACHER.curve.map((p) => p.iteration)).toEqual([300, 600, 900, 1200, 1499]);
    expect(TEACHER.curve.map((p) => p.withDemos)).toEqual([0, 10, 99, 109, 113]);
    expect(TEACHER.curve.map((p) => p.withoutDemos)).toEqual([0, 0, 0, 0, 0]);
  });

  it("ends on the primary numbers, with their Wilson intervals", () => {
    const last = TEACHER.curve[TEACHER.curve.length - 1];
    expect(TEACHER.final.withDemos.k).toBe(last.withDemos);
    expect(TEACHER.final.withoutDemos.k).toBe(last.withoutDemos);
    expect(TEACHER.final.withDemos.ci).toEqual([0.816, 0.928]);
    expect(TEACHER.final.withoutDemos.ci).toEqual([0.0, 0.029]);
    expectWilson(113, 128, TEACHER.final.withDemos.ci);
    expectWilson(0, 128, TEACHER.final.withoutDemos.ci);
  });

  it("never counts more than 128 successes", () => {
    for (const p of TEACHER.curve) {
      expect(p.withDemos).toBeLessThanOrEqual(TEACHER.n);
      expect(p.withoutDemos).toBeLessThanOrEqual(TEACHER.n);
    }
  });
});

describe("the v2 failures", () => {
  it("are the 10 scenes v2 didn't finish: 40 − 30", () => {
    const v2 = CLIMB[CLIMB.length - 1];
    expect(V2_FAILURES.total).toBe(v2.n - v2.k);
    expect(V2_FAILURES.total).toBe(10);
    expect(V2_FAILURES.timedOut).toBe(10);
    expect(V2_FAILURES.timeLimitS).toBe(30);
  });

  it("tallies the reasons as the note does; one failure can carry several", () => {
    expect(V2_FAILURES.reasons.map((r) => [r.key, r.count])).toEqual([
      ["dropped", 10],
      ["not_in_bin", 9],
      ["collision", 5],
      ["gripper_closed", 2],
    ]);
    for (const r of V2_FAILURES.reasons) expect(r.count).toBeLessThanOrEqual(V2_FAILURES.total);
  });

  it("names the 10 failed seeds, all inside the test block 5400–5439", () => {
    expect(V2_FAILURES.failedSeeds).toHaveLength(V2_FAILURES.total);
    expect(new Set(V2_FAILURES.failedSeeds).size).toBe(V2_FAILURES.total);
    for (const s of V2_FAILURES.failedSeeds) {
      expect(s).toBeGreaterThanOrEqual(5400);
      expect(s).toBeLessThanOrEqual(5439);
    }
  });
});

describe("what didn't work", () => {
  it("lists the three published failures", () => {
    expect(DID_NOT_WORK.map((d) => d.key)).toEqual(["held_human", "dagger", "fast_teacher"]);
    expect(DID_NOT_WORK.map((d) => d.figure)).toEqual(["0/110", "7–8/29", "3/50"]);
  });
});

describe("sources", () => {
  it("cites the two pre-registration notes, by name and lines", () => {
    expect(PROOF_NOTES.bigtest.path).toBe("docs/superpowers/notes/2026-10-23-bigtest-prereg.md");
    expect(PROOF_NOTES.distill.path).toBe("docs/superpowers/notes/2026-10-21-distill-prereg.md");
    expect(proofCite({ note: "bigtest", lines: "742–751" })).toBe("Big-test pre-registration note, lines 742–751");
    expect(proofCite({ note: "distill", lines: "1386" })).toBe("Distill pre-registration note, line 1386");
    expect(proofNoteUrl({ note: "bigtest", lines: "742–751" })).toMatch(/\/docs\/superpowers\/notes\/2026-10-23-bigtest-prereg\.md#L742-L751$/);
  });

  it("gives every number a source", () => {
    for (const s of CLIMB) expect(s.source.lines).toMatch(/^\d/);
    expect(TEACHER.source.lines).toMatch(/^\d/);
    expect(V2_FAILURES.source.lines).toMatch(/^\d/);
    for (const d of DID_NOT_WORK) expect(d.sources.length).toBeGreaterThan(0);
  });
});

// site-nav (2026-10-26, the user): the page leads with this. Its numbers are the climb's v2 and the demos the
// distill pre-registration names, never typed twice.
describe("the lead", () => {
  it("is 10 human mouse demos to v2's one-shot 30/40, built from the data", async () => {
    const { LEAD } = await import("./proofData");
    const v2 = CLIMB.find((s) => s.key === "v2")!;
    expect(LEAD.demos).toBe(10);
    expect(LEAD.result).toBe(v2);
    expect(LEAD.headline).toBe(`${LEAD.demos} human mouse demos → ${v2.k}/${v2.n} (75%) on unseen scenes`);
    expect(LEAD.demosSource).toEqual({ note: "distill", lines: "9" });
    expect(LEAD.goal).toBe(GOAL);
  });
});

// intro-proof (2026-10-26): the story's proof beats show the teacher's speed gate as a before/after, so its numbers
// are data here too, cited to the distill pre-registration and T3's gate note.
describe("the teacher's speed gate", () => {
  /** The gate's Wilson bounds are printed to 2 places: each within 0.005 of a computed one. */
  function expectWilson2(k: number, n: number, ci: [number, number]) {
    const [lo, hi] = wilson(k, n);
    expect(Math.abs(ci[0] - lo)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(ci[1] - hi)).toBeLessThanOrEqual(0.005);
  }

  it("failed SANT's physics replay at 3/50 uncapped (median 1.73 m/s) and passed 50/50 capped at 0.5 m/s", () => {
    const { before, after, passMark } = TEACHER_GATE;
    expect([before.k, before.n, before.speed]).toEqual([3, 50, 1.73]);
    expect([after.k, after.n, after.speed]).toEqual([50, 50, 0.5]);
    expect([passMark.k, passMark.n]).toEqual([45, 50]);
    expect(before.k).toBeLessThan(passMark.k);
    expect(after.k).toBeGreaterThanOrEqual(passMark.k);
    expectWilson2(before.k, before.n, before.ci);
    expectWilson2(after.k, after.n, after.ci);
  });

  it("names the three seeds that passed, inside the first gate's fresh block, and the second gate's own block", () => {
    const { before, after } = TEACHER_GATE;
    expect(before.seeds).toEqual([5300, 5349]);
    expect(after.seeds).toEqual([5350, 5399]);
    expect(before.passedSeeds).toEqual([5303, 5308, 5313]);
    expect(before.passedSeeds).toHaveLength(before.k);
    for (const s of before.passedSeeds) {
      expect(s).toBeGreaterThanOrEqual(before.seeds[0]);
      expect(s).toBeLessThanOrEqual(before.seeds[1]);
    }
    expect(before.seeds[1] - before.seeds[0] + 1).toBe(before.n);
    expect(after.seeds[1] - after.seeds[0] + 1).toBe(after.n);
  });

  it("cites both notes for each side", () => {
    expect(PROOF_NOTES.gate.path).toBe("docs/superpowers/notes/2026-10-21-rl-teacher-gate.md");
    expect(proofCite({ note: "gate", lines: "25" })).toBe("RL teacher gate note, line 25");
    for (const side of [TEACHER_GATE.before, TEACHER_GATE.after]) expect(side.sources.map((s) => s.note)).toEqual(["distill", "gate"]);
    expect(TEACHER_GATE.passMark.source.lines).toMatch(/^\d/);
  });

  it("is where the Results page's \"first teacher was too fast\" setback takes its numbers", () => {
    const fast = DID_NOT_WORK.find((d) => d.key === "fast_teacher")!;
    expect(fast.figure).toBe(`${TEACHER_GATE.before.k}/${TEACHER_GATE.before.n}`);
    expect(fast.text).toBe("It moved at an unrealistic 1.7 m/s, so SANT's physics replay caught it (3/50). A 0.5 m/s cap fixed it (50/50).");
  });
});

describe("the climb's short footnote", () => {
  it("is the user's one line, from the same source as the long one", () => {
    expect(CLIMB_FOOTNOTE_SHORT).toBe("Each bar is its own pre-registered test, run once; v2 on fresh seeds.");
    expect(CLIMB_FOOTNOTE_SOURCE).toEqual({ note: "bigtest", lines: "765" });
  });
});
