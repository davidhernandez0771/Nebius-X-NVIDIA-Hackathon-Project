import { describe, expect, it } from "vitest";
import { powerOnPlan } from "./powerOn";
import { DURATIONS, STAGGER } from "./tokens";

describe("powerOnPlan", () => {
  it("covers, lights the four units, navigates while covered, then reveals", () => {
    const plan = powerOnPlan(false);
    expect(plan.map((p) => p.phase)).toEqual(["cover", "light", "light", "navigate", "light", "light", "reveal", "done"]);
  });

  it("lights S, A, N, T one stagger apart", () => {
    const lights = powerOnPlan(false).filter((p) => p.phase === "light");
    expect(lights.map((p) => p.unit)).toEqual([0, 1, 2, 3]);
    const gaps = lights.slice(1).map((p, i) => p.at - lights[i].at);
    expect(gaps).toEqual([STAGGER.sant, STAGGER.sant, STAGGER.sant]);
  });

  it("navigates only once the cover has finished growing", () => {
    const plan = powerOnPlan(false);
    const cover = plan.find((p) => p.phase === "cover")!;
    const navigate = plan.find((p) => p.phase === "navigate")!;
    expect(navigate.at).toBe(cover.at + cover.duration!);
  });

  it("ends at the power-on duration token", () => {
    const plan = powerOnPlan(false);
    expect(plan[plan.length - 1]).toMatchObject({ phase: "done", at: DURATIONS.power });
  });

  it("is in time order", () => {
    const at = powerOnPlan(false).map((p) => p.at);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("is an instant route change with no overlay when motion is reduced", () => {
    expect(powerOnPlan(true)).toEqual([
      { phase: "navigate", at: 0 },
      { phase: "done", at: 0 },
    ]);
  });
});
