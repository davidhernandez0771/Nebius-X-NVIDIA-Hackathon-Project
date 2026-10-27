import { describe, expect, it } from "vitest";
import { parseRun } from "../testtrack/model";
import { CLIP, RAW_RUN, V2_RUN } from "./fixtures";
import { clipDuration, clipStep, closestToCube, parseClip, sharedFrame, standingText, statusText, TAIL_S, touchedCube } from "./model";

describe("parseClip", () => {
  it("reads the caption, both sides' pre-registered counts and the pairs", () => {
    const c = parseClip(CLIP);
    expect(c.caption).toBe("Same 10 demos. Same scene. 0/40 vs 30/40.");
    expect(c.label).toBe("Illustrative replay");
    expect(c.sides.raw.headline).toEqual({ successes: 0, n: 40, seeds: [5020, 5059] });
    expect(c.sides.v2.headline).toEqual({ successes: 30, n: 40, seeds: [5400, 5439] });
    expect(c.pairs.map((p) => p.seed)).toEqual([5403, 5404]);
    expect(c.pairs[0].raw).toMatchObject({ file: "runs/raw/5403.json", success: false, reasons: ["not_in_bin"], endedBy: "time_limit", standing: "illustrative" });
    expect(c.pairs[0].v2).toMatchObject({ file: "runs/v2/5403.json", success: true, durationS: 7.48, standing: "counted" });
  });

  it("refuses a run file outside the clip's folders and an unknown standing", () => {
    const bad = (raw: Record<string, unknown>) => ({ ...CLIP, pairs: [{ ...CLIP.pairs[0], raw: { ...CLIP.pairs[0].raw, ...raw } }] });
    expect(() => parseClip(bad({ file: "../secret.json" }))).toThrow(/run file/);
    expect(() => parseClip(bad({ standing: "best" }))).toThrow(/standing/);
    expect(() => parseClip({ ...CLIP, caption: "" })).toThrow(/caption/);
  });
});

describe("the clip's clock", () => {
  const raw = parseRun(RAW_RUN(5403)); // 5 s
  const v2 = parseRun(V2_RUN(5403)); // 2 s

  it("plays until the quicker run is done plus the tail, never past the longer run", () => {
    expect(clipDuration(raw, v2)).toBe(2 + TAIL_S);
    expect(clipDuration(v2, raw)).toBe(2 + TAIL_S);
    expect(clipDuration(raw, { nSteps: 16, fps: 4 })).toBe(5); // 4 s + 2.5 s would pass the 5 s run
  });

  it("holds a finished run on its last step", () => {
    expect(clipStep(0, v2)).toBe(0);
    expect(clipStep(1, v2)).toBe(4);
    expect(clipStep(3, v2)).toBe(7);
    expect(clipStep(3, raw)).toBe(12);
  });

  it("frames both runs alike: the robot, both bins and both paths", () => {
    expect(sharedFrame(raw, v2)).toHaveLength(2 + (1 + 20 + 20) + (1 + 8 + 8));
  });
});

describe("the words", () => {
  const raw = parseRun(RAW_RUN(5403));
  const v2 = parseRun(V2_RUN(5403));
  const c = parseClip(CLIP);

  it("knows whether the fingers ever touched the cube, and how close the hand came", () => {
    expect(touchedCube(raw)).toBe(false);
    expect(touchedCube(v2)).toBe(true);
    expect(touchedCube({ contacts: null })).toBeNull();
    expect(closestToCube(raw)).toBeCloseTo(0.2, 5);
    expect(closestToCube({ handPos: null, cubePos: null })).toBeNull();
  });

  it("says each robot is running until the quicker one ends, then both verdicts", () => {
    expect(statusText(c.pairs[0].raw, raw, 1, 2)).toBe("Running · 1.0 s");
    expect(statusText(c.pairs[0].v2, v2, 1, 2)).toBe("Running · 1.0 s");
    expect(statusText(c.pairs[0].v2, v2, 2, 2)).toBe("✓ In the bin · 7.5 s · verified by SANT");
    expect(statusText(c.pairs[0].raw, raw, 2.5, 2)).toBe("✕ Failed · never touched the cube · kept trying to the 30 s limit");
  });

  it("names a dropped cube, and a miss when the fingers did touch it", () => {
    const touched = parseRun({ ...RAW_RUN(1), contacts: { gripper_cube: [[2, 5]], arm_bin: [], arm_table: [] } });
    expect(statusText({ ...c.pairs[0].raw, reasons: ["not_in_bin", "dropped"] }, touched, 9, 2)).toMatch(/^✕ Failed · dropped the cube/);
    expect(statusText(c.pairs[0].raw, touched, 9, 2)).toMatch(/^✕ Failed · the cube missed the bin/);
  });

  it("says where each run stands against its pre-registered count", () => {
    expect(standingText("counted", 5403, c.sides.v2)).toBe("Seed 5403 is one of the runs counted in its 30/40 (seeds 5400–5439).");
    expect(standingText("illustrative", 5403, c.sides.raw)).toBe("Run for this picture on seed 5403: not part of its 0/40 (seeds 5020–5059).");
    expect(standingText("rerun", 5020, c.sides.raw)).toMatch(/^A traced re-run of seed 5020, counted in its 0\/40/);
  });
});
