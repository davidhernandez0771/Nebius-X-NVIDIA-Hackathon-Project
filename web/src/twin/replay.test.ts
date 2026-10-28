import { describe, expect, it } from "vitest";
import { END_HOLD_S, parseEpisode, ReplayClock, stateAt } from "./replay";

const NAMES = ["panda_joint1", "panda_finger_joint1"];
const BODY = {
  demo_id: "s1_0000_m100002",
  source: "variant",
  robot: "franka",
  fps: 50,
  n_steps: 3,
  joint_names: NAMES,
  joint_pos: [
    [-0.9622, 0.04],
    [-0.9, 0.03],
    [-0.8, 0.025],
  ],
  gripper: [0, 1, 1],
  cube_pos: [
    [0.4947, -0.0602, 0.025],
    [0.5, -0.05, 0.03],
    [0.53, 0.27, 0.035],
  ],
  cube_quat: [0.998, 0, 0, -0.0631],
  bin: [0.532, 0.2706, 0, 1, 0, 0, 0],
  base: [0, 0, 0, 1, 0, 0, 0],
  verified: true,
  lineage: ["s1_0000", "s1_0000_m100002"],
};

describe("parseEpisode", () => {
  it("reads the route's episode", () => {
    const ep = parseEpisode(BODY);
    expect(ep.nSteps).toBe(3);
    expect(ep.bin).toEqual({ pos: [0.532, 0.2706, 0], quat: [1, 0, 0, 0] });
    expect(ep.verified).toBe(true);
    expect(parseEpisode({ ...BODY, cube_pos: null, verified: null }).cubePos).toBeNull();
  });

  it("refuses a short or ragged episode", () => {
    expect(() => parseEpisode({ ...BODY, joint_pos: BODY.joint_pos.slice(1) })).toThrow(/joint_pos/);
    expect(() => parseEpisode({ ...BODY, joint_pos: [[1], [2], [3]] })).toThrow(/joint_pos/);
    expect(() => parseEpisode({ ...BODY, bin: [1, 2] })).toThrow(/bin/);
  });
});

describe("stateAt", () => {
  it("poses the twin from one step: named joints, gripper, cube with its start orientation, bin", () => {
    const s = stateAt(parseEpisode(BODY), 1);
    expect(s.joints).toEqual({ panda_joint1: -0.9, panda_finger_joint1: 0.03 });
    expect(s.gripper).toBe(1);
    expect(s.cube).toEqual({ pos: [0.5, -0.05, 0.03], quat: [0.998, 0, 0, -0.0631] });
    expect(s.bin?.pos).toEqual([0.532, 0.2706, 0]);
    expect(stateAt(parseEpisode(BODY), 99).gripper).toBe(1); // clamped to the last step
  });
});

describe("ReplayClock", () => {
  it("shows the first step at once, then at most 30 poses a second on a 60 Hz screen", () => {
    const clock = new ReplayClock(500, 50); // 10 s
    expect(clock.advance(0)).toBe(0);
    let shown = 0;
    for (let i = 0; i < 60; i++) if (clock.advance(1 / 60) !== null) shown++;
    expect(shown).toBeGreaterThanOrEqual(28);
    expect(shown).toBeLessThanOrEqual(30);
  });

  it("plays in real time: 1 s in is step 50", () => {
    const clock = new ReplayClock(500, 50);
    clock.advance(0);
    for (let i = 0; i < 100; i++) clock.advance(0.01);
    expect(clock.stepAt(clock.t)).toBe(50);
  });

  it("ends on the last step, holds, then plays again from the start", () => {
    const clock = new ReplayClock(10, 50); // 0.2 s
    clock.advance(0);
    expect(clock.advance(0.25)).toBe(9); // past the end: the last step, before the hold
    expect(clock.advance(END_HOLD_S - 0.1)).toBeNull(); // holding
    expect(clock.advance(0.06)).toBe(0); // looped
  });

  it("seeks to a step", () => {
    const clock = new ReplayClock(100, 50);
    expect(clock.seek(42.4)).toBe(42);
    expect(clock.t).toBeCloseTo(0.84);
    expect(clock.seek(1e9)).toBe(99);
  });
});
