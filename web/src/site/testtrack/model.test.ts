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
  reasonText,
  stepAt,
  summaryText,
  verdictText,
  type RunRow,
} from "./model";
import { INDEX, RUN } from "./fixtures";

describe("the index", () => {
  it("reads every source, its runs and the round-0 cube estimate", () => {
    const ix = parseIndex(INDEX);
    expect(ix.sources.map((s) => s.id)).toEqual(["teacher-gate", "distill-r0"]);
    const [gate, r0] = ix.sources;
    expect(gate.runs[0]).toMatchObject({ id: "5350", recorded: true, durationS: 2.82, inEnv: true, cubeSource: "recorded" });
    expect(gate.cubeEstimate).toBeNull();
    expect(r0.runs[1]).toMatchObject({ recorded: false, file: null, success: false, reasons: ["dropped"], endedBy: "time_limit", steps: 1500 });
    expect(r0.cubeEstimate).toEqual({ episodes: 82, heldMedianMm: 13.9, heldP95Mm: 24.5, landedMedianMm: 28, landedMaxMm: 61 });
  });

  it("refuses a body that isn't an index", () => {
    expect(() => parseIndex({})).toThrow(/index/);
    expect(() => parseIndex({ sources: [{ ...INDEX.sources[0], summary: { successes: 1, n: 1 } }] })).toThrow(/interval/);
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
    const runs = parseIndex(INDEX).sources[1].runs as RunRow[];
    expect(neighbourRun(runs, "4000", 1)).toBe("4000"); // 4022 saved no replay
    const gate = parseIndex(INDEX).sources[0].runs;
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
    expect(summaryText(parseIndex(INDEX).sources[0])).toBe("2/2 verified by SANT replay · Wilson 95% 93%–100%");
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
    expect(estimateText(parseIndex(INDEX).sources[1].cubeEstimate!)).toMatch(/On 82 runs .* 1\.4 cm \(median\) while carried and 2\.8 cm where it landed/);
  });
});
