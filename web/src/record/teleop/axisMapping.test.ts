// Which way the arm goes for each hand motion (B7), from a synthetic hand in the RAW webcam image to the target
// the sim gets (hudModel.toTarget mirrors demo_pipeline.teleop.to_ee_target). The webcam faces the user, so the
// user's right is the raw image's left (smaller x). Robot frame: x forward (away from the base), y to the robot's
// left, z up.
//   "behind" (Robot's view, the default): you stand behind the robot. Your right = its right (-y); your hand toward
//            the camera = forward (+x); up = up.
//   "facing" (the mirror): the robot faces you. Your right = its left (+y); toward the camera = toward you, its
//            forward (+x); up = up.

import { describe, expect, it } from "vitest";
import type { TrackedHand } from "../../hand/contracts";
import { toTarget } from "../../site/record-hud/hudModel";
import { FRAME, makeHandPose } from "./__fixtures__/handPoses";
import { DEFAULT_TELEOP_CONTROL, type TeleopControlSettings, type TeleopView } from "./controlRegion";
import { HandControl } from "./handControl";

type HandAt = { x?: number; y?: number; distance?: number };

function target(view: TeleopView, at: HandAt, s: Partial<TeleopControlSettings> = {}) {
  const pose = makeHandPose({ center: { x: at.x ?? 0.5, y: at.y ?? 0.45 }, distance: at.distance ?? 0.5 });
  const hand: TrackedHand = { landmarks: pose.landmarks, worldLandmarks: pose.world, handedness: "Left" };
  const out = new HandControl().step(hand, { timestamp: 0, frameWidth: FRAME.w, frameHeight: FRAME.h }, { ...DEFAULT_TELEOP_CONTROL, view, ...s }, { clutch: false, spaceGripper: 0 });
  return toTarget(out.msg).ee;
}

const USERS_RIGHT = { x: 0.4 }; // raw image left
const USERS_LEFT = { x: 0.6 };

describe.each<[TeleopView, number]>([
  ["behind", -1], // the user's right is the robot's right: -y
  ["facing", +1], // the user's right is the robot's left: +y
])("%s", (view, rightSign) => {
  it("left/right: moving to the user's right moves the arm to its " + (rightSign < 0 ? "right (-y)" : "left (+y)"), () => {
    const right = target(view, USERS_RIGHT)[1];
    const left = target(view, USERS_LEFT)[1];
    expect(Math.sign(right - left)).toBe(rightSign);
    expect(Math.abs(right - left)).toBeGreaterThan(0.1);
  });

  it("forward/back: the hand toward the camera reaches forward (+x)", () => {
    const near = target(view, { distance: 0.42 })[0];
    const far = target(view, { distance: 0.6 })[0];
    expect(near - far).toBeGreaterThan(0.1);
  });

  it("up/down: raising the hand raises the arm (+z)", () => {
    const up = target(view, { y: 0.3 })[2];
    const down = target(view, { y: 0.55 })[2];
    expect(up - down).toBeGreaterThan(0.1);
  });

  it("the left/right inversion setting still flips on top of the view", () => {
    const right = target(view, USERS_RIGHT, { invertX: true })[1];
    const left = target(view, USERS_LEFT, { invertX: true })[1];
    expect(Math.sign(right - left)).toBe(-rightSign);
  });
});

it("the Robot's view (behind the robot) is the default", () => {
  expect(DEFAULT_TELEOP_CONTROL.view).toBe("behind");
});
