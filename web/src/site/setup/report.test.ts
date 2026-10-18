import { describe, expect, it } from "vitest";
import frankaParts from "./fixtures/franka.parts.json";
import frankaReport from "./fixtures/franka.report.json";
import openarmParts from "./fixtures/openarm.parts.json";
import openarmReport from "./fixtures/openarm.report.json";
import { designFlaw, overallProgress, reachCells, reasons, stageLabel, verdictLabel } from "./report";
import type { Parts, ReportCard } from "./types";

const oaParts = openarmParts as unknown as Parts;
const oa = openarmReport as unknown as ReportCard;
const panda = frankaReport as unknown as ReportCard;

describe("reasons", () => {
  it("sorts the failure reasons by count, with plain labels", () => {
    expect(reasons(oa)).toEqual([
      { code: "unreachable", label: "Couldn't follow the path", count: 30 },
      { code: "collision", label: "Hit the table or the bin", count: 13 },
      { code: "not_in_bin", label: "Cube missed the bin", count: 10 },
      { code: "dropped", label: "Dropped the cube", count: 8 },
    ]);
    expect(reasons(panda)).toEqual([]);
  });

  it("keeps an unknown code readable", () => {
    const r = { ...oa, pick_place: { ...oa.pick_place, failure_reasons: { value: { new_code: 2 }, source: "" } } };
    expect(reasons(r)).toEqual([{ code: "new_code", label: "new code", count: 2 }]);
  });
});

describe("reachCells", () => {
  it("counts, per cell, the layers that reach it", () => {
    const cells = reachCells(oa);
    expect(cells).toHaveLength(oa.reach_map.grid.x.length);
    expect(cells[0]).toHaveLength(oa.reach_map.grid.y.length);
    expect(cells[5].every((c) => c.count === 0)).toBe(true); // x = 0.65: nothing reaches
    expect(reachCells(panda).flat().every((c) => c.count === 5)).toBe(true);
  });
});

describe("designFlaw", () => {
  it("names the narrowest joint that keeps hitting its limit (OpenArm joint 6, ±45°)", () => {
    expect(designFlaw(oa, oaParts)).toEqual({
      joint: "openarm_joint6",
      index: 6,
      of: 7,
      lowerDeg: -45,
      upperDeg: 45,
      scenes: 17,
      n: 30,
      unreachable: 30,
      reach: 0.513,
    });
  });

  it("finds none for a robot that is ready", () => {
    expect(designFlaw(panda, frankaParts as unknown as Parts)).toBeNull();
  });
});

describe("labels", () => {
  it("says what the verdict means", () => {
    expect(verdictLabel("not_ready")).toBe("Not ready");
    expect(verdictLabel("ready")).toBe("Ready");
  });

  it("names the running stage", () => {
    expect(stageLabel({ stage: "convert", done: 0, total: 1 })).toBe("Converting the URDF for Isaac Sim");
    expect(stageLabel({ stage: "pick_place", done: 12, total: 30 })).toBe("Pick and place: scene 13 of 30");
    expect(stageLabel({ stage: "pick_place", done: 30, total: 30 })).toBe("Pick and place: writing the card");
  });

  it("weights the stages into one progress number", () => {
    expect(overallProgress(null)).toBe(0);
    expect(overallProgress({ stage: "convert", done: 1, total: 1 })).toBeCloseTo(0.1);
    expect(overallProgress({ stage: "pick_place", done: 15, total: 30 })).toBeCloseTo(0.2 + 0.4);
    expect(overallProgress({ stage: "pick_place", done: 30, total: 30 })).toBeCloseTo(1);
  });
});
