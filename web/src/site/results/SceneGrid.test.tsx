// The lead's scene grid shows the raw episode log (scenes.json, scripts/build_scene_grid.py): it must agree with the
// numbers the rest of the page states (proofData.ts), or the picture and the headline would tell different stories.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LEAD, V2_FAILURES } from "./proofData";
import { SCENES, SceneGrid, medianSuccessSeconds } from "./SceneGrid";

describe("SceneGrid", () => {
  it("has the big test's 40 seeds, 5400–5439, in order", () => {
    expect(SCENES.map((s) => s.seed)).toEqual(Array.from({ length: 40 }, (_, i) => 5400 + i));
  });

  it("agrees with the headline: 30 of 40 in the bin, and the same 10 failed seeds", () => {
    expect(SCENES.filter((s) => s.success).length).toBe(LEAD.result.k);
    expect(SCENES.length).toBe(LEAD.result.n);
    expect(SCENES.filter((s) => !s.success).map((s) => s.seed)).toEqual(V2_FAILURES.failedSeeds);
  });

  it("every failure dropped the cube, so each failed cell may say so", () => {
    expect(SCENES.filter((s) => !s.success).every((s) => s.reasons.includes("dropped"))).toBe(true);
  });

  it("takes the median of the successes: the mean of the middle two of 30", () => {
    expect(medianSuccessSeconds()).toBeCloseTo(8.23, 2);
    expect(medianSuccessSeconds([{ seed: 1, success: true, sim_s: 3, reasons: [] }])).toBe(3);
  });

  it("names each cell for a screen reader", () => {
    render(<SceneGrid goal={24} />);
    expect(screen.getByRole("list", { name: "40 test scenes, 30 in the bin" })).toBeTruthy();
    expect(screen.getByLabelText("Seed 5400: dropped the cube")).toBeTruthy();
    expect(screen.getByLabelText("Seed 5401: in the bin in 9.5 s")).toBeTruthy();
  });
});
