import { describe, expect, it } from "vitest";
import type { PoseUi } from "../../record/useRecordSession";
import type { HandPoseMsg } from "../../record/teleop/handPoseMessage";
import { LIVE_HISTORY } from "./liveHud";
import { SCENE, TOP_VIEW, fitBox, initialLive, sidePoint, stepLive, topPoint, tracePath, traceX } from "./twin";

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

const pose = (over: Partial<PoseUi> = {}): PoseUi => ({
  msg: msg(),
  framing: { state: "ok", hints: [] },
  gripper: 0,
  pinch: 0.8,
  victory: 0.1,
  reset: { timestamp: 100, phase: "idle", progress: 0, event: null },
  size3d: null,
  landmarks: null,
  ...over,
});

const box = { left: 0, top: 0, width: 180, height: 100 };

describe("the twin's views", () => {
  it("top view: forward is up, the robot's left (+y) is on the left, like the mirrored camera", () => {
    const [xc, yc] = topPoint(0.5, 0, box);
    expect([xc, yc]).toEqual([90, 50]);
    expect(topPoint(TOP_VIEW.x[1], 0, box)[1]).toBe(0); // farthest reach at the top
    expect(topPoint(0.5, SCENE.bin.y, box)[0]).toBeLessThan(xc); // the bin (+y) left of the cube
    // A hand moving to the user's right (u falls in the raw frame, pad x grows) moves the target to -y: right.
    expect(topPoint(0.5, -0.2, box)[0]).toBeGreaterThan(xc);
  });

  it("side view: the table (z = 0) is the bottom edge, higher targets sit higher", () => {
    expect(sidePoint(0.25, 0, box)).toEqual([0, 100]);
    expect(sidePoint(0.5, 0.2, box)[1]).toBeLessThan(sidePoint(0.5, 0.1, box)[1]);
  });

  it("fitBox keeps the aspect and centers the box", () => {
    expect(fitBox(400, 100, 2, 10, 20)).toEqual({ left: 110, top: 20, width: 200, height: 100 });
    expect(fitBox(100, 400, 2)).toEqual({ left: 0, top: 175, width: 100, height: 50 });
  });

  it("traces grow in from the right: the newest sample is at the right edge", () => {
    expect(traceX(0, 1, 100)).toBeCloseTo(100);
    expect(traceX(LIVE_HISTORY - 1, LIVE_HISTORY, 100)).toBeCloseTo(100);
    expect(traceX(0, LIVE_HISTORY, 100)).toBe(0);
    expect(tracePath([0, 1], [0, 1], 79, 10, 80)).toBe("M78.0 10.0L79.0 0.0");
  });
});

describe("stepLive", () => {
  it("keeps the target's y and the gripper for every tracked pose, alongside liveHud's histories", () => {
    let s = stepLive(initialLive(), pose({ gripper: 0 }));
    s = stepLive(s, pose({ gripper: 1, msg: msg({ control: [0.2, 0.5, 0.5] }) }));
    expect(s.gripHistory).toEqual([0, 1]);
    expect(s.yHistory).toHaveLength(2);
    expect(s.yHistory[0]).toBeCloseTo(0);
    expect(s.yHistory[1]).toBeLessThan(0); // u 0.2 in the raw frame = the user's right in the mirror = -y
    expect(topPoint(0.5, s.yHistory[1], box)[0]).toBeGreaterThan(90); // so the twin's dot moves right too
    expect(s.hud.xHistory).toHaveLength(2);
  });

  it("holds the histories while the hand is lost and empties them when the camera stops", () => {
    const live = stepLive(initialLive(), pose());
    const lost = stepLive(live, pose({ msg: msg({ tracking_ok: false }), pinch: null }));
    expect(lost.yHistory).toEqual(live.yHistory);
    expect(lost.gripHistory).toEqual(live.gripHistory);
    expect(stepLive(lost, null)).toEqual(initialLive());
  });

  it("keeps 8 s like the rest of the page", () => {
    let s = initialLive();
    for (let i = 0; i < LIVE_HISTORY + 10; i++) s = stepLive(s, pose({ msg: msg({ t_ms: i * 100 }) }));
    expect(s.yHistory).toHaveLength(LIVE_HISTORY);
    expect(s.gripHistory).toHaveLength(LIVE_HISTORY);
  });
});
