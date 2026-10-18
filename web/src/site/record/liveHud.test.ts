import { describe, expect, it } from "vitest";
import type { PoseUi } from "../../pm/record/useRecordSession";
import type { HandPoseMsg } from "../../teleop/handPoseMessage";
import { WORKSPACE, initialHud } from "../record-hud";
import { LIVE_HISTORY, stepLiveHud } from "./liveHud";

const msg = (over: Partial<HandPoseMsg> = {}): HandPoseMsg => ({
  t_ms: 100,
  tracking_ok: true,
  wrist_uv: [0.5, 0.5],
  palm_width: 0.1,
  pinch_ratio: 1,
  yaw_rad: 0,
  frame_w: 640,
  frame_h: 480,
  control: [0.5, 0.5, 0.5],
  ...over,
});

const hand = Array.from({ length: 21 }, (_, i) => [0.3 + i * 0.01, 0.4] as const);

const pose = (over: Partial<PoseUi> = {}): PoseUi => ({
  msg: msg(),
  framing: { state: "ok", hints: [] },
  gripper: 0,
  pinch: 0.8,
  victory: 0.1,
  reset: { timestamp: 100, phase: "idle", progress: 0, event: null },
  size3d: null,
  landmarks: hand,
  ...over,
});

describe("stepLiveHud", () => {
  it("is empty without a pose (camera off)", () => {
    const s = stepLiveHud(stepLiveHud(initialHud(), pose()), null);
    expect(s).toEqual(initialHud());
  });

  it("takes the gripper and the pinch gap from the session (hand v4), not the sim's pinch_ratio latch", () => {
    // pinch_ratio 0.1 would close the sim's own latch; hand v4's latch says open.
    const s = stepLiveHud(initialHud(), pose({ msg: msg({ pinch_ratio: 0.1 }), gripper: 0, pinch: 0.9 }));
    expect(s.gripper).toBe(0);
    expect(s.pinch).toBe(0.9);
    expect(stepLiveHud(s, pose({ gripper: 1, pinch: 0.2 })).gripper).toBe(1);
  });

  it("maps the control triple through toTarget: the middle of the region is the middle of the workspace", () => {
    const s = stepLiveHud(initialHud(), pose());
    expect(s.target?.ee[0]).toBeCloseTo((WORKSPACE.x[0] + WORKSPACE.x[1]) / 2);
    expect(s.target?.ee[2]).toBeCloseTo((WORKSPACE.z[0] + WORKSPACE.z[1]) / 2);
    expect(s.target?.pad).toEqual({ x: 0.5, y: 0.5 });
  });

  it("marks the edge from the session's framing (the control region or the depth range)", () => {
    expect(stepLiveHud(initialHud(), pose()).target?.edge).toBe(false);
    expect(stepLiveHud(initialHud(), pose({ framing: { state: "edge", hints: ["Move your hand left"] } })).target?.edge).toBe(true);
  });

  it("holds the last target and gripper while tracking is lost, and drops the hand", () => {
    const live = stepLiveHud(initialHud(), pose({ gripper: 1 }));
    const lost = stepLiveHud(live, pose({ msg: msg({ tracking_ok: false, t_ms: 200 }), gripper: 1, pinch: null, landmarks: null }));
    expect(lost.tracking).toBe(false);
    expect(lost.target).toEqual(live.target);
    expect(lost.gripper).toBe(1);
    expect(lost.landmarks).toBeNull();
    expect(lost.zHistory).toEqual(live.zHistory);
  });

  it("keeps 8 s of history at the session's 10 Hz", () => {
    let s = initialHud();
    for (let i = 0; i < LIVE_HISTORY + 25; i++) s = stepLiveHud(s, pose({ msg: msg({ t_ms: i * 100 }) }));
    expect(LIVE_HISTORY).toBe(80);
    expect(s.zHistory).toHaveLength(LIVE_HISTORY);
    expect(s.xHistory).toHaveLength(LIVE_HISTORY);
    expect(s.trail).toHaveLength(LIVE_HISTORY);
  });
});
