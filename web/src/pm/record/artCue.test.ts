import { describe, expect, it } from "vitest";

import { ArtCue, type ArtCueInput } from "./artCue";

const base: ArtCueInput = { gripper: 0, recording: false, resets: 0 };

describe("ArtCue: one count per thing that happens, for the hand-art style changes", () => {
  it("the first frame is not an event, and nothing changing is none", () => {
    const c = new ArtCue();
    expect(c.update(base)).toBe(0);
    expect(c.update(base)).toBe(0);
  });

  it("counts grab, release, a Reset scene, record start and record stop", () => {
    const c = new ArtCue();
    c.update(base);
    const steps: Partial<ArtCueInput>[] = [{ gripper: 1 }, { gripper: 0 }, { resets: 1 }, { recording: true }, { recording: false }];
    let state = base;
    steps.forEach((patch, i) => {
      state = { ...state, ...patch };
      expect(c.update(state)).toBe(i + 1);
    });
  });

  it("several changes in one frame are one event", () => {
    const c = new ArtCue();
    c.update(base);
    expect(c.update({ ...base, gripper: 1, recording: true })).toBe(1);
  });
});
