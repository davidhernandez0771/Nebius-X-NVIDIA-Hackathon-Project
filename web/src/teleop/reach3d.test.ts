import { describe, expect, it } from "vitest";

import { FRAME, makeHandPose, type HandPoseOptions } from "./__fixtures__/handPoses";
import type { TrackedHand } from "../hand/contracts";
import { depthSize, reachSize3d, scaleFit } from "./reach3d";

const rad = (d: number) => (d * Math.PI) / 180;

function hand(opts: HandPoseOptions = {}): TrackedHand {
  const { world, landmarks } = makeHandPose(opts);
  return { landmarks, worldLandmarks: world, handedness: "Right" };
}
const palmWidth2d = (h: TrackedHand) =>
  Math.hypot((h.landmarks[5].x - h.landmarks[17].x) * FRAME.w, (h.landmarks[5].y - h.landmarks[17].y) * FRAME.h) / FRAME.w;
const size3d = (h: TrackedHand) => reachSize3d(h, FRAME.w, FRAME.h)!;

describe("scaleFit: s = sum(x_img . X_w) / sum |X_w|^2 over the centered landmarks", () => {
  it("is the camera's px per meter at the hand: f / Z", () => {
    const h = hand({ distance: 0.5 });
    // Within a few percent: the fixture projects with true perspective, the fit assumes weak.
    expect(scaleFit(h.landmarks, h.worldLandmarks!, FRAME.w, FRAME.h)! / (FRAME.focalPx / 0.5)).toBeCloseTo(1, 1);
  });

  it("is null when it can't be fitted (flat world, too few points, a negative fit)", () => {
    const h = hand();
    const flat = h.worldLandmarks!.map(() => ({ x: 0, y: 0, z: 0 }));
    expect(scaleFit(h.landmarks, flat, FRAME.w, FRAME.h)).toBeNull();
    expect(scaleFit(h.landmarks, h.worldLandmarks!.slice(0, 3), FRAME.w, FRAME.h)).toBeNull();
    const flipped = h.worldLandmarks!.map((p) => ({ x: -p.x, y: -p.y, z: p.z }));
    expect(scaleFit(h.landmarks, flipped, FRAME.w, FRAME.h)).toBeNull();
  });
});

describe("reachSize3d: the 3D reach signal, in palm-width units", () => {
  it("equals the pixel palm width with the palm facing the camera", () => {
    const h = hand();
    expect(size3d(h) / palmWidth2d(h)).toBeCloseTo(1, 1);
  });

  it("goes as 1 / distance", () => {
    expect(size3d(hand({ distance: 0.4 })) / size3d(hand({ distance: 0.8 }))).toBeCloseTo(2, 1);
  });

  it("barely changes when the hand turns, while the pixel palm width collapses", () => {
    const facing = size3d(hand());
    for (const deg of [40, 60, 75]) {
      const h = hand({ rot: { y: rad(deg) } });
      expect(Math.abs(size3d(h) / facing - 1)).toBeLessThan(0.06);
      expect(palmWidth2d(h) / palmWidth2d(hand())).toBeLessThan(Math.cos(rad(deg)) + 0.1);
    }
  });

  it("is null without world landmarks", () => {
    expect(reachSize3d({ ...hand(), worldLandmarks: undefined }, FRAME.w, FRAME.h)).toBeNull();
  });
});

describe("depthSize: what reach is computed from", () => {
  it("is the palm width unless 3D reach is on; with it on, the 3D size, else the palm width", () => {
    const h = hand({ rot: { y: rad(60) } });
    const pw = palmWidth2d(h);
    expect(depthSize(h, pw, FRAME.w, FRAME.h, false)).toBe(pw);
    expect(depthSize(h, pw, FRAME.w, FRAME.h, true)).toBe(size3d(h));
    expect(depthSize({ ...h, worldLandmarks: undefined }, pw, FRAME.w, FRAME.h, true)).toBe(pw);
  });
});
