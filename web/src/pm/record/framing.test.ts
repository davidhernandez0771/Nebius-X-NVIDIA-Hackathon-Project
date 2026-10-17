import { describe, expect, it } from "vitest";

import { DEFAULT_TELEOP_CONTROL, type TeleopControlSettings } from "../../teleop/controlRegion";
import { GRIPPER, TABLE_MARK, Z_RANGE, controlFraming, nextGripper, robotHeight } from "./framing";

const S: TeleopControlSettings = { ...DEFAULT_TELEOP_CONTROL, region: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 } };

describe("controlFraming (control region on)", () => {
  it("is ok with the palm center inside the region and the palm width inside the depth range", () => {
    expect(controlFraming({ center: { x: 0.5, y: 0.5 }, palmWidth: 0.1 }, S)).toEqual({ state: "ok", hints: [] });
  });
  it("no hand", () => {
    expect(controlFraming(null, S).state).toBe("no-hand");
  });
  it("hints in the mirrored view, like framingCheck: raw left of the region is the user's right", () => {
    expect(controlFraming({ center: { x: 0.2, y: 0.5 }, palmWidth: 0.1 }, S).hints).toEqual(["Move your hand left"]);
    expect(controlFraming({ center: { x: 0.8, y: 0.5 }, palmWidth: 0.1 }, S).hints).toEqual(["Move your hand right"]);
    expect(controlFraming({ center: { x: 0.5, y: 0.2 }, palmWidth: 0.1 }, S).hints).toEqual(["Move your hand down"]);
    expect(controlFraming({ center: { x: 0.5, y: 0.8 }, palmWidth: 0.1 }, S).hints).toEqual(["Move your hand up"]);
  });
  it("hints for depth with the configured near/far", () => {
    expect(controlFraming({ center: { x: 0.5, y: 0.5 }, palmWidth: 0.05 }, S).hints).toEqual(["Bring your hand closer"]);
    expect(controlFraming({ center: { x: 0.5, y: 0.5 }, palmWidth: 0.2 }, S).hints).toEqual(["Move your hand back"]);
  });
});

describe("robotHeight", () => {
  it("follows the sim's z mapping: control v = 0 is the top, v = 1 the table", () => {
    expect(robotHeight([0.5, 1, 0.5])).toEqual({ fraction: 0, z: Z_RANGE[0] });
    expect(robotHeight([0.5, 0, 0.5]).fraction).toBe(1);
    expect(robotHeight([0.5, 0.5, 0.5]).z).toBeCloseTo((Z_RANGE[0] + Z_RANGE[1]) / 2, 12);
  });
  it("marks the table (cube) level near the bottom of the bar", () => {
    expect(TABLE_MARK).toBeGreaterThanOrEqual(0);
    expect(TABLE_MARK).toBeLessThan(0.05);
  });
});

describe("nextGripper (mirrors demo_pipeline.teleop.GripperLatch)", () => {
  it("closes below close_below, opens above open_above, holds in between and while lost", () => {
    expect(GRIPPER).toEqual({ closeBelow: 0.35, openAbove: 0.45 });
    expect(nextGripper(0, { tracking_ok: true, pinch_ratio: 0.3 })).toBe(1);
    expect(nextGripper(1, { tracking_ok: true, pinch_ratio: 0.4 })).toBe(1);
    expect(nextGripper(1, { tracking_ok: true, pinch_ratio: 0.5 })).toBe(0);
    expect(nextGripper(0, { tracking_ok: true, pinch_ratio: 0.4 })).toBe(0);
    expect(nextGripper(1, { tracking_ok: false, pinch_ratio: 0.9 })).toBe(1);
  });
});
