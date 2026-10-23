import { describe, expect, it } from "vitest";
import { armTask, resetArmTask } from "./armTask";

describe("the arm's task", () => {
  it("resets to looking about, fingers open, the spiral wanted in place", () => {
    Object.assign(armTask, { active: true, closed: 1, glow: 1, liftWant: 1 });
    resetArmTask();
    expect(armTask.active).toBe(false);
    expect(armTask.closed).toBe(0);
    expect(armTask.glow).toBe(0);
    expect(armTask.liftWant).toBe(0);
  });
});
