// Keyboard and mouse driving (drive.ts): keys and mouse deltas in the robot's own frame -> a smooth, clamped tool
// target -> the HandPoseMsg the camera path sends. hudModel.toTarget mirrors the sim's to_ee_target, so a message is
// checked by mapping it back; tests/test_drive_mapping.py checks the same fixture against the Python itself.

import { describe, expect, it } from "vitest";
import { WORKSPACE, toTarget } from "../../site/record-hud/hudModel";
import fixture from "./__fixtures__/drive_msgs.json";
import {
  Drive,
  FINE,
  HOME,
  RAMP_S,
  TICK_S,
  WHEEL_M,
  controlOf,
  driveMessage,
  keyAxes,
  mouseDelta,
  sanitizeDriveSettings,
  wheelDelta,
  yawAxis,
  yawWheelDelta,
  MOVE_CODES,
  YAW_MAX,
  YAW_NOTCH,
  YAW_SPEED,
  DEFAULT_DRIVE,
  type Vec3,
} from "./drive";

const keys = (...codes: string[]) => new Set(codes);
const SPEED = 0.1;

/** Hold the keys for `s` seconds at the page's tick, then let go for `after` seconds. */
function hold(d: Drive, codes: string[], s: number, opts: { fine?: boolean; after?: number; speed?: number } = {}): Vec3[] {
  const path: Vec3[] = [];
  for (let t = 0; t < s; t += TICK_S) path.push(d.step(TICK_S, keyAxes(keys(...codes)), { speed: opts.speed ?? SPEED, fine: !!opts.fine }));
  for (let t = 0; t < (opts.after ?? 0); t += TICK_S) path.push(d.step(TICK_S, [0, 0, 0], { speed: opts.speed ?? SPEED, fine: !!opts.fine }));
  return path;
}

const last = (p: Vec3[]) => p[p.length - 1];
const sentTarget = (p: Vec3) => toTarget(driveMessage(p, 0, 0)).ee;

describe("keys in the robot's own frame (as if standing behind it)", () => {
  it.each<[string, string[], number, number]>([
    ["W: forward, away from the base (+x)", ["KeyW"], 0, +1],
    ["S: back, toward the base (-x)", ["KeyS"], 0, -1],
    ["A: the robot's left (+y)", ["KeyA"], 1, +1],
    ["D: the robot's right (-y)", ["KeyD"], 1, -1],
    ["R: up (+z)", ["KeyR"], 2, +1],
    ["F: down (-z)", ["KeyF"], 2, -1],
    ["Arrow up = W", ["ArrowUp"], 0, +1],
    ["Arrow down = S", ["ArrowDown"], 0, -1],
    ["Arrow left = A", ["ArrowLeft"], 1, +1],
    ["Arrow right = D", ["ArrowRight"], 1, -1],
  ])("%s", (_, codes, axis, sign) => {
    const d = new Drive();
    const p = last(hold(d, codes, 0.5));
    const moved = p[axis] - HOME[axis];
    expect(Math.sign(moved)).toBe(sign);
    expect(Math.abs(moved)).toBeGreaterThan(0.02);
    for (const other of [0, 1, 2].filter((k) => k !== axis)) expect(p[other]).toBeCloseTo(HOME[other], 9);
    // and the sim, mapping the message, goes the same way
    const sent = sentTarget(p);
    expect(sent[axis]).toBeCloseTo(p[axis], 9);
  });

  it("opposite keys cancel, and keys don't care about other keys", () => {
    expect(keyAxes(keys("KeyW", "KeyS"))).toEqual([0, 0, 0]);
    expect(keyAxes(keys("KeyQ", "Tab"))).toEqual([0, 0, 0]);
  });

  it("a diagonal is no faster than a straight line", () => {
    const [x, y] = keyAxes(keys("KeyW", "KeyA"));
    expect(Math.hypot(x, y)).toBeCloseTo(1);
  });
});

describe("smooth motion: velocity with a short acceleration ramp", () => {
  it("ramps up to the speed over RAMP_S instead of jumping", () => {
    const d = new Drive();
    d.step(TICK_S, [1, 0, 0], { speed: SPEED, fine: false });
    expect(d.vel[0]).toBeGreaterThan(0);
    expect(d.vel[0]).toBeLessThan(SPEED / 4);
    hold(d, ["KeyW"], RAMP_S);
    expect(d.vel[0]).toBeCloseTo(SPEED, 9);
  });

  it("ramps down after the key is released, so the arm doesn't stop dead", () => {
    const d = new Drive();
    hold(d, ["KeyW"], 0.6);
    const before = d.pos[0];
    d.step(TICK_S, [0, 0, 0], { speed: SPEED, fine: false });
    expect(d.pos[0]).toBeGreaterThan(before); // still moving
    hold(d, [], RAMP_S + TICK_S);
    expect(d.vel[0]).toBe(0);
  });

  it("never steps further in a tick than the speed allows, and its acceleration is bounded", () => {
    const d = new Drive();
    const path = hold(d, ["KeyW", "KeyR"], 1, { after: 0.5 });
    const v = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1], p[2] - path[i][2]) / TICK_S);
    expect(Math.max(...v)).toBeLessThanOrEqual(SPEED * 1.0001);
    const a = v.slice(1).map((s, i) => Math.abs(s - v[i]) / TICK_S);
    expect(Math.max(...a)).toBeLessThanOrEqual((SPEED / RAMP_S) * 1.0001);
  });

  it("Shift is the fine mode: a fraction of the speed", () => {
    const d = new Drive();
    hold(d, ["KeyD"], 1, { fine: true });
    expect(Math.abs(d.vel[1])).toBeCloseTo(SPEED * FINE, 9);
  });
});

describe("the workspace clamp", () => {
  it.each<[string, string, number, number]>([
    ["far forward", "KeyW", 0, WORKSPACE.x[1]],
    ["all the way back", "KeyS", 0, WORKSPACE.x[0]],
    ["far left", "KeyA", 1, WORKSPACE.y[1]],
    ["far right", "KeyD", 1, WORKSPACE.y[0]],
    ["top", "KeyR", 2, WORKSPACE.z[1]],
    ["the table", "KeyF", 2, WORKSPACE.z[0]],
  ])("stops at the %s edge, with no velocity left to push past it", (_, code, axis, edge) => {
    const d = new Drive();
    hold(d, [code], 15, { speed: 0.3 });
    expect(d.pos[axis]).toBeCloseTo(edge, 9);
    expect(d.vel[axis]).toBe(0);
    const c = controlOf(d.pos);
    for (const v of c) expect(v >= 0 && v <= 1).toBe(true);
  });
});

describe("the gripper", () => {
  it("toggles on Space, starts open, and goes out as grip", () => {
    const d = new Drive();
    expect(d.gripper).toBe(0);
    d.toggleGripper();
    expect(d.gripper).toBe(1);
    expect(driveMessage(d.pos, d.gripper, 5).grip).toBe(1);
    d.toggleGripper();
    expect(driveMessage(d.pos, d.gripper, 5).grip).toBe(0);
  });

  it("reset puts the target home, still, and opens the gripper", () => {
    const d = new Drive();
    hold(d, ["KeyW"], 0.5);
    d.toggleGripper();
    d.reset();
    expect([d.pos, d.vel, d.gripper]).toEqual([[...HOME], [0, 0, 0], 0]);
  });
});

describe("the mouse (Pointer Lock deltas, in the robot's frame)", () => {
  it("mouse up = forward, mouse right = the robot's right, wheel up = up", () => {
    const s = DEFAULT_DRIVE.mouseSens;
    expect(mouseDelta(0, -100, s, false)[0]).toBeCloseTo(100 * s);
    expect(mouseDelta(100, 0, s, false)[1]).toBeCloseTo(-100 * s);
    expect(mouseDelta(100, 0, s, false)[0]).toBe(0);
    expect(wheelDelta(-100, false)[2]).toBeCloseTo(WHEEL_M);
    expect(wheelDelta(100, false)[2]).toBeCloseTo(-WHEEL_M);
  });

  it("Shift is fine for the mouse too", () => {
    expect(mouseDelta(0, -100, 0.001, true)[0]).toBeCloseTo(100 * 0.001 * FINE);
  });

  it("moves the target through the same smoothing (a ramp, not a jump) and the same clamp", () => {
    const d = new Drive();
    d.nudge(mouseDelta(0, -200, 0.0005, false)); // 10 cm forward in one mouse event
    const first = d.step(TICK_S, [0, 0, 0], { speed: SPEED, fine: false });
    expect(first[0] - HOME[0]).toBeGreaterThan(0);
    expect(first[0] - HOME[0]).toBeLessThan(0.01);
    hold(d, [], 3);
    expect(d.pos[0]).toBeCloseTo(HOME[0] + 0.1, 3);
    d.nudge(mouseDelta(-100000, 0, 0.0005, false)); // far past the robot's left edge
    hold(d, [], 15);
    expect(d.pos[1]).toBeCloseTo(WORKSPACE.y[1], 9);
  });
});

describe("the message", () => {
  it("is a tracked HandPoseMsg the backend accepts, with the target as control", () => {
    const m = driveMessage([0.5, -0.1, 0.2], 1, 1234);
    expect(m.tracking_ok).toBe(true);
    expect(m.palm_width).toBeGreaterThan(0);
    expect(m.wrist_uv.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(m.control).toHaveLength(3);
    expect(m.t_ms).toBe(1234);
    expect(toTarget(m).ee.map((v) => +v.toFixed(9))).toEqual([0.5, -0.1, 0.2]);
  });

  it("matches the fixture the Python test maps with to_ee_target", () => {
    for (const row of fixture.rows) {
      const m = driveMessage(row.target as Vec3, row.grip as 0 | 1, row.msg.t_ms);
      expect(m.control!.map((v) => +v.toFixed(12))).toEqual(row.msg.control.map((v: number) => +v.toFixed(12)));
      expect({ ...m, control: undefined }).toEqual({ ...row.msg, control: undefined });
    }
  });
});

describe("drive settings", () => {
  it("default to the keyboard, with speed and mouse sensitivity in range", () => {
    expect(DEFAULT_DRIVE.input).toBe("keyboard");
    expect(sanitizeDriveSettings(null)).toEqual(DEFAULT_DRIVE);
  });

  it("keep valid values and fall back per field", () => {
    expect(sanitizeDriveSettings({ input: "mouse", speed: 0.2, mouseSens: 0.001 })).toEqual({ input: "mouse", speed: 0.2, mouseSens: 0.001, softFloor: true });
    expect(sanitizeDriveSettings({ softFloor: false }).softFloor).toBe(false); // the soft floor: on unless turned off
    expect(sanitizeDriveSettings({ softFloor: "no" }).softFloor).toBe(true);
    const s = sanitizeDriveSettings({ input: "joystick", speed: 99, mouseSens: "x" });
    expect(s.input).toBe(DEFAULT_DRIVE.input);
    expect(s.speed).toBeLessThanOrEqual(0.3);
    expect(s.mouseSens).toBe(DEFAULT_DRIVE.mouseSens);
  });
});

describe("the wrist (yaw): Q / E, and Shift+wheel for the mouse (the lead's addition)", () => {
  const spin = (d: Drive, axis: number, seconds: number, fine = false) => {
    let out = d.yaw;
    for (let t = 0; t < seconds; t += TICK_S) {
      d.step(TICK_S, [0, 0, 0], { speed: 0.1, fine }, axis);
      out = d.yaw;
    }
    return out;
  };

  it("Q turns the wrist one way (counter-clockwise from above), E the other, and Q/E are keys the drive uses", () => {
    expect(yawAxis(new Set(["KeyQ"]))).toBe(1);
    expect(yawAxis(new Set(["KeyE"]))).toBe(-1);
    expect(yawAxis(new Set(["KeyQ", "KeyE"]))).toBe(0);
    expect(MOVE_CODES).toEqual(expect.arrayContaining(["KeyQ", "KeyE"]));
    expect(spin(new Drive(), 1, 0.5)).toBeGreaterThan(0.2);
    expect(spin(new Drive(), -1, 0.5)).toBeLessThan(-0.2);
  });

  it("ramps up and down like the other axes, never a step", () => {
    const d = new Drive();
    const yaws: number[] = [];
    for (let i = 0; i < 30; i++) {
      d.step(TICK_S, [0, 0, 0], { speed: 0.1, fine: false }, i < 15 ? 1 : 0);
      yaws.push(d.yaw);
    }
    const steps = yaws.slice(1).map((y, i) => y - yaws[i]);
    expect(steps[0]).toBeLessThan(steps[10]); // still speeding up at first
    expect(Math.max(...steps)).toBeLessThanOrEqual(YAW_SPEED * TICK_S + 1e-9);
    expect(steps[steps.length - 1]).toBeCloseTo(0, 6); // and it stops after the key goes up
  });

  it("is clamped to +-90 degrees", () => {
    expect(spin(new Drive(), 1, 5)).toBeCloseTo(YAW_MAX, 9);
    expect(spin(new Drive(), -1, 5)).toBeCloseTo(-YAW_MAX, 9);
    expect(YAW_MAX).toBeCloseTo(Math.PI / 2, 9);
  });

  it("Shift is the fine mode for the wrist too", () => {
    expect(spin(new Drive(), 1, 0.4, true)).toBeLessThan(spin(new Drive(), 1, 0.4) * 0.5);
  });

  it("Shift+wheel nudges the wrist and it follows smoothly", () => {
    const d = new Drive();
    d.nudgeYaw(yawWheelDelta(-100)); // one notch up
    const first = (d.step(TICK_S, [0, 0, 0], { speed: 0.1, fine: false }), d.yaw);
    for (let i = 0; i < 40; i++) d.step(TICK_S, [0, 0, 0], { speed: 0.1, fine: false });
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(YAW_NOTCH);
    expect(d.yaw).toBeCloseTo(YAW_NOTCH, 3);
  });

  it("goes out as yaw_rad, and reset turns it back", () => {
    const d = new Drive();
    spin(d, 1, 0.5);
    expect(driveMessage(d.pos, 0, 0, d.yaw).yaw_rad).toBeCloseTo(d.yaw, 12);
    expect(driveMessage(d.pos, 0, 0).yaw_rad).toBe(0);
    d.reset();
    expect(d.yaw).toBe(0);
  });
});
