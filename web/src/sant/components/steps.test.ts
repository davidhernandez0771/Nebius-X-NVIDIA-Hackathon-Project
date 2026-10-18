import { describe, expect, it } from "vitest";
import { SANT_STEPS, unitState } from "./steps";

describe("S·A·N·T steps", () => {
  it("are the four words of the name, in order", () => {
    expect(SANT_STEPS.map((s) => s.letter).join("")).toBe("SANT");
    expect(SANT_STEPS.map((s) => s.name)).toEqual(["Simulate", "Augment", "Neaten", "Train"]);
  });
});

describe("unitState", () => {
  it("marks steps before the active one done, the active one active, the rest idle", () => {
    expect([0, 1, 2, 3].map((i) => unitState(i, 2))).toEqual(["done", "done", "active", "idle"]);
  });

  it("is all idle with no active step", () => {
    expect([0, 1, 2, 3].map((i) => unitState(i, null))).toEqual(["idle", "idle", "idle", "idle"]);
  });

  it("is all done past the last step", () => {
    expect([0, 1, 2, 3].map((i) => unitState(i, 4))).toEqual(["done", "done", "done", "done"]);
  });
});
