import { describe, expect, it } from "vitest";
import type { HandPoseMsg } from "../../record/teleop/handPoseMessage";
import {
  HISTORY,
  WORKSPACE,
  formatClock,
  frameAt,
  initialHud,
  knobAngle,
  meanRateHz,
  stepHud,
  toTarget,
} from "./hudModel";

function msg(over: Partial<HandPoseMsg> = {}): HandPoseMsg {
  return {
    t_ms: 0,
    tracking_ok: true,
    wrist_uv: [0.5, 0.5],
    palm_width: 0.1,
    pinch_ratio: 1,
    yaw_rad: 0,
    frame_w: 640,
    frame_h: 480,
    ...over,
  };
}

describe("toTarget (mirrors demo_pipeline.teleop.to_ee_target)", () => {
  it("maps the middle of the calibration region to the middle of the workspace", () => {
    const t = toTarget(msg());
    expect(t.ee[0]).toBeCloseTo(0.5, 9);
    expect(t.ee[1]).toBeCloseTo(0, 9);
    expect(t.ee[2]).toBeCloseTo(0.21, 9);
    expect(t.pad.x).toBeCloseTo(0.5, 9);
    expect(t.pad.y).toBeCloseTo(0.5, 9);
    expect(t.edge).toBe(false);
  });

  it("mirrors u: the camera's left is the user's right, which is robot -y", () => {
    const t = toTarget(msg({ wrist_uv: [0.2, 0.5] }));
    expect(t.pad.x).toBeCloseTo(1, 9);
    expect(t.ee[1]).toBeCloseTo(WORKSPACE.y[0], 9);
  });

  it("raises z as the hand rises (v falls) and reaches out as the palm grows", () => {
    const high = toTarget(msg({ wrist_uv: [0.5, 0.15], palm_width: 0.14 }));
    expect(high.ee[2]).toBeCloseTo(WORKSPACE.z[1], 9);
    expect(high.ee[0]).toBeCloseTo(WORKSPACE.x[1], 9);
    expect(high.pad.y).toBeCloseTo(0, 9);
  });

  it("clamps outside the region and flags it as the edge", () => {
    const t = toTarget(msg({ wrist_uv: [0.95, 0.99], palm_width: 0.01 }));
    expect(t.pad).toEqual({ x: 0, y: 1 });
    expect(t.ee).toEqual([WORKSPACE.x[0], WORKSPACE.y[1], WORKSPACE.z[0]]);
    expect(t.edge).toBe(true);
  });

  it("uses the control triple when the browser sends one", () => {
    const t = toTarget(msg({ wrist_uv: [0.9, 0.9], palm_width: 0.01, control: [0.25, 0.25, 1] }));
    expect(t.pad.x).toBeCloseTo(0.75, 9);
    expect(t.pad.y).toBeCloseTo(0.25, 9);
    expect(t.ee[0]).toBeCloseTo(WORKSPACE.x[1], 9);
    expect(t.ee[2]).toBeCloseTo(WORKSPACE.z[0] + 0.75 * (WORKSPACE.z[1] - WORKSPACE.z[0]), 9);
  });

  it("turns yaw into degrees", () => {
    expect(toTarget(msg({ yaw_rad: Math.PI / 4 })).yawDeg).toBeCloseTo(45, 9);
  });
});

describe("stepHud", () => {
  it("latches the gripper with the sim's hysteresis", () => {
    let s = initialHud();
    s = stepHud(s, msg({ pinch_ratio: 0.4 }));
    expect(s.gripper).toBe(0);
    s = stepHud(s, msg({ pinch_ratio: 0.3 }));
    expect(s.gripper).toBe(1);
    s = stepHud(s, msg({ pinch_ratio: 0.4 }));
    expect(s.gripper).toBe(1);
    s = stepHud(s, msg({ pinch_ratio: 0.5 }));
    expect(s.gripper).toBe(0);
  });

  it("holds the last target while tracking is lost, as the sim does", () => {
    let s = stepHud(initialHud(), msg({ wrist_uv: [0.3, 0.3], pinch_ratio: 0.2 }));
    const held = s.target;
    s = stepHud(s, msg({ tracking_ok: false, wrist_uv: [0, 0], palm_width: 0, pinch_ratio: 0.9 }));
    expect(s.tracking).toBe(false);
    expect(s.target).toBe(held);
    expect(s.gripper).toBe(1);
    expect(s.landmarks).toBeNull();
  });

  it("keeps capped histories of height, reach and the palm trail", () => {
    let s = initialHud();
    for (let i = 0; i < HISTORY + 10; i++) s = stepHud(s, msg({ wrist_uv: [0.5, 0.15 + (i % 7) / 10] }), [[0.5, 0.5]]);
    expect(s.zHistory).toHaveLength(HISTORY);
    expect(s.xHistory).toHaveLength(HISTORY);
    expect(s.zHistory[HISTORY - 1]).toBe(s.target!.ee[2]);
    expect(s.trail.length).toBeLessThanOrEqual(HISTORY);
  });
});

describe("frameAt", () => {
  const frames = [{ t_ms: 0 }, { t_ms: 100 }, { t_ms: 200 }];

  it("returns the newest frame at or before t, looping over the session", () => {
    expect(frameAt(frames, 0)).toBe(0);
    expect(frameAt(frames, 150)).toBe(1);
    expect(frameAt(frames, 299)).toBe(2);
    // One frame period past the last frame, the loop starts again.
    expect(frameAt(frames, 300)).toBe(0);
    expect(frameAt(frames, 450)).toBe(1);
  });
});

describe("meanRateHz", () => {
  it("measures the message rate from the timestamps", () => {
    expect(meanRateHz([{ t_ms: 0 }, { t_ms: 50 }, { t_ms: 100 }])).toBeCloseTo(20, 9);
    expect(meanRateHz([{ t_ms: 0 }])).toBeNull();
  });
});

describe("formatClock", () => {
  it("shows minutes, seconds and tenths with a fixed width", () => {
    expect(formatClock(0)).toBe("00:00.0");
    expect(formatClock(4_849)).toBe("00:04.8");
    expect(formatClock(65_000)).toBe("01:05.0");
    expect(formatClock(-5)).toBe("00:00.0");
  });
});

describe("knobAngle", () => {
  it("sweeps 270 degrees around the top, optionally reversed", () => {
    expect(knobAngle(0, 0, 1)).toBe(-135);
    expect(knobAngle(1, 0, 1)).toBe(135);
    expect(knobAngle(0.5, 0, 1)).toBe(0);
    expect(knobAngle(0, 0, 1, true)).toBe(135);
    expect(knobAngle(9, 0, 1)).toBe(135);
  });
});
