import { describe, expect, it } from "vitest";
import { powerOnPlan } from "./powerOn";
import { DURATIONS, STAGGER } from "./tokens";

describe("powerOnPlan", () => {
  it("covers, gathers the dust, navigates while covered, lights the four units, then reveals", () => {
    const plan = powerOnPlan(false);
    expect(plan.map((p) => p.phase)).toEqual(["cover", "gather", "navigate", "light", "light", "light", "light", "reveal", "done"]);
  });

  it("lights S, A, N, T one stagger apart", () => {
    const lights = powerOnPlan(false).filter((p) => p.phase === "light");
    expect(lights.map((p) => p.unit)).toEqual([0, 1, 2, 3]);
    const gaps = lights.slice(1).map((p, i) => p.at - lights[i].at);
    expect(gaps).toEqual([STAGGER.sant, STAGGER.sant, STAGGER.sant]);
  });

  it("lights each unit at the moment its dust lands", () => {
    const plan = powerOnPlan(false);
    const gather = plan.find((p) => p.phase === "gather");
    if (gather?.phase !== "gather") throw new Error("no gather step");
    expect(gather.stagger).toBe(STAGGER.sant);
    for (const light of plan) {
      if (light.phase !== "light") continue;
      expect(light.at).toBe(gather.at + gather.duration + light.unit * gather.stagger);
    }
  });

  it("starts gathering while the cover is still growing", () => {
    const plan = powerOnPlan(false);
    const cover = plan.find((p) => p.phase === "cover")!;
    const gather = plan.find((p) => p.phase === "gather")!;
    expect(gather.at).toBeGreaterThan(cover.at);
    expect(gather.at).toBeLessThan(cover.at + (cover.phase === "cover" ? cover.duration : 0));
  });

  it("navigates only once the cover has finished growing", () => {
    const plan = powerOnPlan(false);
    const cover = plan.find((p) => p.phase === "cover");
    const navigate = plan.find((p) => p.phase === "navigate")!;
    if (cover?.phase !== "cover") throw new Error("no cover step");
    expect(navigate.at).toBe(cover.at + cover.duration);
  });

  it("reveals only after the last unit has lit", () => {
    const plan = powerOnPlan(false);
    const lastLight = Math.max(...plan.filter((p) => p.phase === "light").map((p) => p.at));
    expect(plan.find((p) => p.phase === "reveal")!.at).toBeGreaterThan(lastLight);
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
