import { describe, expect, it } from "vitest";

import { FIST_FLEX, FRAME, VICTORY_FLEX, VICTORY_THUMB, makeHandPose, type HandPoseOptions } from "./__fixtures__/handPoses";
import type { TrackedHand } from "../../hand/contracts";
import { victoryScore } from "./victoryPose";

const rad = (d: number) => (d * Math.PI) / 180;
const OPEN: [number, number, number] = [0.08, 0.08, 0.05];

function hand(opts: HandPoseOptions = {}, world = true): TrackedHand {
  const p = makeHandPose(opts);
  return { landmarks: p.landmarks, handedness: "Right", ...(world ? { worldLandmarks: p.world } : {}) };
}
const victory = (o: HandPoseOptions = {}) => hand({ fingerFlex: VICTORY_FLEX, thumbTip: VICTORY_THUMB, ...o });
const score = (h: TrackedHand) => victoryScore(h, FRAME.w, FRAME.h);

describe("victoryScore: index and middle extended, ring and pinky curled", () => {
  it("scores the V sign high, from world landmarks", () => {
    const s = score(victory());
    expect(s.source).toBe("3d");
    expect(s.score).toBeGreaterThan(0.9);
  });

  it("scores other hand shapes low", () => {
    const shapes: Record<string, HandPoseOptions> = {
      open: {},
      fist: { flex: FIST_FLEX },
      pointing: { fingerFlex: [OPEN, FIST_FLEX, FIST_FLEX, FIST_FLEX] },
      three: { fingerFlex: [OPEN, OPEN, OPEN, FIST_FLEX] },
      rock: { fingerFlex: [OPEN, FIST_FLEX, FIST_FLEX, OPEN] },
    };
    for (const [name, o] of Object.entries(shapes)) expect([name, score(hand(o)).score < 0.3]).toEqual([name, true]);
  });

  it("holds up when the hand is turned or tilted (3D joint angles)", () => {
    for (const rot of [{ y: rad(45) }, { x: rad(30) }, { z: rad(40) }]) expect(score(victory({ rot })).score).toBeGreaterThan(0.85);
  });

  it("falls back to 2D image angles without world landmarks", () => {
    const v = victoryScore(hand({ fingerFlex: VICTORY_FLEX, thumbTip: VICTORY_THUMB }, false), FRAME.w, FRAME.h);
    expect(v.source).toBe("2d");
    expect(v.score).toBeGreaterThan(0.7);
    expect(victoryScore(hand({}, false), FRAME.w, FRAME.h).score).toBeLessThan(0.3);
  });
});
