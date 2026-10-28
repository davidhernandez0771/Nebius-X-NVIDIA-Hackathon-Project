import { describe, expect, it } from "vitest";
import {
  advance,
  estimateText,
  factTags,
  keyAction,
  neighbourRun,
  nextSpeed,
  parseIndex,
  parseRun,
  contactsAt,
  reasonText,
  shownRuns,
  stepAt,
  summaryText,
  verdictText,
  type RunRow,
} from "./model";
import { FINAL_RUN, INDEX, RUN } from "./fixtures";

describe("the index", () => {
  it("reads every source, its runs and the round-0 cube estimate", () => {
    const ix = parseIndex(INDEX);
    expect(ix.sources.map((s) => s.id)).toEqual(["final-test-v2", "teacher-gate", "distill-r0"]);
    const [, gate, r0] = ix.sources;
    expect(gate.runs[0]).toMatchObject({ id: "5350", recorded: true, durationS: 2.82, inEnv: true, cubeSource: "recorded" });
    expect(gate.cubeEstimate).toBeNull();
    expect(r0.runs[1]).toMatchObject({ recorded: false, file: null, success: false, reasons: ["dropped"], endedBy: "time_limit", steps: 1500 });
    expect(r0.cubeEstimate).toEqual({ episodes: 82, heldMedianMm: 13.9, heldP95Mm: 24.5, landedMedianMm: 28, landedMaxMm: 61 });
  });

  it("refuses a body that isn't an index", () => {
    expect(() => parseIndex({})).toThrow(/index/);
    expect(() => parseIndex({ sources: [{ ...INDEX.sources[1], summary: { successes: 1, n: 1 } }] })).toThrow(/interval/);
  });
});

describe("a run", () => {
  it("is the twin's episode plus its cube source, contact and facts", () => {
    const r = parseRun(RUN());
    expect(r.nSteps).toBe(4);
    expect(r.cubeSource).toBe("recorded");
    expect(r.contactN).toEqual([0, 0, 1.5, 0]);
    expect(r.facts).toEqual({ success: true, reasons: [], durationS: 2.82, pathM: 1.41, peakContactN: 1.5, settleS: 0.7 });
    expect(parseRun(RUN({ cube_source: "estimated", contact_n: null })).cubeSource).toBe("estimated");
    expect(parseRun(RUN({ contact_n: [1] })).contactN).toBeNull(); // the wrong length is no contact, not a wrong one
    expect(r.handPos).toHaveLength(4);
    expect(parseRun(RUN({ hand_pos: undefined })).handPos).toBeNull();
  });
});

describe("playback", () => {
  it("loops over the run and the hold, at any speed", () => {
    expect(advance(0, 1, 1, 2.8, 1.2)).toBeCloseTo(1);
    expect(advance(0, 1, 0.25, 2.8, 1.2)).toBeCloseTo(0.25);
    expect(advance(3.5, 1, 1, 2.8, 1.2)).toBeCloseTo(0.5);
    expect(advance(1, -5, 1, 2.8)).toBeCloseTo(1); // a clock never runs backwards
  });

  it("holds the last step through the hold", () => {
    const run = { nSteps: 142, fps: 50 };
    expect(stepAt(0, run)).toBe(0);
    expect(stepAt(1, run)).toBe(50);
    expect(stepAt(3.5, run)).toBe(141);
  });

  it("steps through the speeds and stops at the ends", () => {
    expect(nextSpeed(1, 1)).toBe(2);
    expect(nextSpeed(1, -1)).toBe(0.5);
    expect(nextSpeed(4, 1)).toBe(4);
    expect(nextSpeed(0.25, -1)).toBe(0.25);
  });

  it("goes to the next run that has a replay, wrapping round", () => {
    const runs = parseIndex(INDEX).sources[2].runs as RunRow[];
    expect(neighbourRun(runs, "4000", 1)).toBe("4000"); // 4022 saved no replay
    const gate = parseIndex(INDEX).sources[1].runs;
    expect(neighbourRun(gate, "5351", 1)).toBe("5350");
    expect(neighbourRun(gate, "5350", -1)).toBe("5351");
    expect(neighbourRun(gate, "nope", 1)).toBe("5350");
  });
});

describe("the keyboard", () => {
  const key = (k: string, over: Record<string, unknown> = {}) => keyAction({ key: k, target: document.body, ...over });
  it("maps the shortcuts", () => {
    expect(key(" ")).toEqual({ type: "toggle" });
    expect(key("ArrowRight")).toEqual({ type: "step", by: 1 });
    expect(key("ArrowLeft", { shiftKey: true })).toEqual({ type: "step", by: -10 });
    expect(key("]")).toEqual({ type: "speed", dir: 1 });
    expect(key("k")).toEqual({ type: "run", dir: 1 });
    expect(key("J")).toEqual({ type: "run", dir: -1 });
    expect(key("2")).toEqual({ type: "source", index: 1 });
    expect(key("r")).toEqual({ type: "resetView" });
    expect(key("t")).toEqual({ type: "trails" });
    expect(key("?")).toEqual({ type: "help" });
    expect(key("x")).toBeNull();
  });

  it("leaves fields, buttons' Space and browser shortcuts alone", () => {
    const input = document.createElement("input");
    expect(keyAction({ key: "ArrowRight", target: input })).toBeNull();
    expect(keyAction({ key: "Escape", target: input })).toEqual({ type: "close" });
    expect(keyAction({ key: " ", target: document.createElement("button") })).toBeNull();
    expect(key("r", { ctrlKey: true })).toBeNull();
  });
});

describe("the words", () => {
  it("says why a run failed in plain words", () => {
    expect(reasonText(["dropped"], "time_limit")).toBe("dropped the cube, stopped at the time limit");
    expect(reasonText(["collision"])).toBe("pushed into the bin or the table");
    expect(reasonText(["some_new_reason"])).toBe("some new reason");
    expect(verdictText({ success: true, reasons: [] })).toBe("In the bin · verified");
    expect(verdictText({ success: false, reasons: ["dropped"] })).toBe("Failed · dropped the cube");
  });

  it("states the summary with its interval", () => {
    expect(summaryText(parseIndex(INDEX).sources[1])).toBe("2/2 verified by SANT replay · Wilson 95% 93%–100%");
  });

  it("tags the facts the run has, and where its cube came from", () => {
    const f = parseRun(RUN()).facts;
    expect(factTags(f, "estimated")).toEqual([
      { label: "Time", value: "2.82 s" },
      { label: "Peak arm contact", value: "1.5 N" },
      { label: "Hand path", value: "1.41 m" },
      { label: "Cube settled in", value: "0.70 s" },
      { label: "Cube path", value: "estimated from the gripper" },
    ]);
    expect(factTags({ ...f, durationS: null, pathM: null, peakContactN: null, settleS: null }, null)).toEqual([]);
  });

  it("states how far off the estimated cube is", () => {
    expect(estimateText(parseIndex(INDEX).sources[2].cubeEstimate!)).toMatch(/On 82 runs .* 1\.4 cm \(median\) while carried and 2\.8 cm where it landed/);
  });
});

describe("the final test", () => {
  const final = () => parseIndex(INDEX).sources[0];

  it("is the first source: 40 runs, 30 verified, with the eval's Wilson interval and judge", () => {
    const s = final();
    expect(s.id).toBe("final-test-v2");
    expect(s.runs).toHaveLength(40);
    expect(s.runs.filter((r) => r.success)).toHaveLength(30);
    expect(s.runs.every((r) => r.recorded)).toBe(true);
    expect(summaryText(s)).toBe("30/40 verified by SANT's check_success, as each run ran · Wilson 95% 60%–86%");
    expect(s.note).toMatch(/re-made from the scene's seed/);
    expect(parseIndex(INDEX).sources[1].note).toBeNull();
  });

  it("says why each failed run failed", () => {
    const failed = final().runs.filter((r) => !r.success);
    expect(failed.map((r) => r.seed)).toEqual([5400, 5402, 5408, 5409, 5413, 5421, 5427, 5433, 5437, 5439]);
    expect(failed.every((r) => r.reasons.length > 0)).toBe(true);
    expect(reasonText(failed[0].reasons, failed[0].endedBy)).toBe("the cube missed the bin, dropped the cube, stopped at the time limit");
    expect(reasonText(failed[1].reasons)).toBe("the cube missed the bin, never let go, dropped the cube");
  });

  it("shows all runs, the verified ones or the failed ones", () => {
    const runs = final().runs;
    expect(shownRuns(runs, "all")).toHaveLength(40);
    expect(shownRuns(runs, "ok").every((r) => r.success)).toBe(true);
    expect(shownRuns(runs, "ok")).toHaveLength(30);
    expect(shownRuns(runs, "failed").map((r) => r.seed)[0]).toBe(5400);
    expect(shownRuns(runs, "failed")).toHaveLength(10);
    expect(neighbourRun(shownRuns(runs, "failed"), "5400", 1)).toBe("5402"); // J and K stay inside the filter
  });

  it("reads the cube's recorded rotation and the contact sensors, and says what touches at a step", () => {
    const r = parseRun(FINAL_RUN(5408));
    expect(r.cubeQuats).toHaveLength(4);
    expect(r.cubeQuats![2]).toEqual([0.7071, 0.7071, 0, 0]);
    expect(contactsAt(r, 0)).toEqual([]);
    expect(contactsAt(r, 1)).toEqual(["gripper on the cube"]);
    expect(contactsAt(r, 2)).toEqual(["gripper on the cube", "arm on the bin"]);
    expect(contactsAt(r, 3)).toEqual(["arm on the bin"]);
    const plain = parseRun(RUN());
    expect(plain.cubeQuats).toBeNull();
    expect(plain.contacts).toBeNull();
    expect(contactsAt(plain, 1)).toBeNull(); // no sensors recorded: nothing to say, not "nothing touched"
    expect(parseRun(FINAL_RUN(5401, { cube_quat_path: [[1, 0, 0, 0]] })).cubeQuats).toBeNull(); // the wrong length is no path
  });
});

// The built data itself (scripts/build_test_track.py wrote it): the page must open on the real final test.
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(path: string, encoding: "utf-8"): string };

describe("the built index (public/test-track-data)", () => {
  const ix = parseIndex(JSON.parse(fs.readFileSync("public/test-track-data/index.json", "utf-8")));

  it("opens on the final test: 40 runs on seeds 5400-5439, 30 verified, each failure with its reasons", () => {
    const s = ix.sources[0];
    expect(s.id).toBe("final-test-v2");
    expect(s.title).toBe("The final test · 30/40");
    expect(s.seeds).toEqual([5400, 5439]);
    expect(s.summary).toMatchObject({ successes: 30, n: 40 });
    expect(s.summary.ci95[0]).toBeCloseTo(0.598, 3);
    expect(s.summary.ci95[1]).toBeCloseTo(0.858, 3);
    expect(s.runs).toHaveLength(40);
    expect(s.runs.filter((r) => r.success)).toHaveLength(30);
    expect(s.runs.filter((r) => !r.success).every((r) => r.reasons.length > 0 && r.endedBy === "time_limit")).toBe(true);
    expect(s.checkpoint).toMatch(/checkpoints[\\/]180000[\\/]pretrained_model$/);
  });

  it("keeps the earlier sources after it", () => {
    expect(ix.sources.map((s) => s.id)).toEqual(["final-test-v2", "teacher-gate", "teacher-replay-check", "distill-r0"]);
  });
});
