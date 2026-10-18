import { describe, expect, it } from "vitest";

import { FIST_FLEX, FRAME, canonicalHand, makeHandPose, pinchThumbTip } from "./__fixtures__/handPoses";
import type { HandLandmark } from "../hand/contracts";
import { PINCH_CLOSE_BELOW, PINCH_OPEN_ABOVE, PINCH_OPEN_HOLD_MS, PinchLatch, pinchGap } from "./pinch";

const rad = (d: number) => (d * Math.PI) / 180;
const gap = (lm: HandLandmark[]) => pinchGap(lm, FRAME.w, FRAME.h)!;

/** Thumb tip `cm` centimeters from the index tip, sideways (canonical hand, palm to the camera). */
function tipsApart(cm: number, opts: Parameters<typeof makeHandPose>[0] = {}): HandLandmark[] {
  const c = canonicalHand();
  return makeHandPose({ ...opts, thumbTip: { ...c[8], x: c[8].x - cm / 100 } }).landmarks;
}

describe("pinchGap: 2D thumb tip to index tip, over the hand's size (wrist to middle knuckle)", () => {
  it("is near 0 with the tips together and over 1 with the hand open", () => {
    expect(gap(makeHandPose({ thumbTip: pinchThumbTip() }).landmarks)).toBeLessThan(0.1);
    expect(gap(makeHandPose().landmarks)).toBeGreaterThan(1);
  });

  it("does not change with the hand's distance from the camera", () => {
    const near = gap(tipsApart(3, { distance: 0.35 }));
    const far = gap(tipsApart(3, { distance: 0.8 }));
    expect(near).toBeCloseTo(far, 1);
  });

  it("is in px: a non-square frame does not stretch it", () => {
    const lm: HandLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    lm[0] = { x: 0.5, y: 0.6, z: 0 };
    lm[9] = { x: 0.5, y: 0.4, z: 0 }; // 0.2 of 480 px = 96 px
    lm[4] = { x: 0.45, y: 0.3, z: 0 };
    lm[8] = { x: 0.55, y: 0.3, z: 0 }; // 0.1 of 640 px = 64 px
    expect(pinchGap(lm, 640, 480)).toBeCloseTo(64 / 96, 6);
  });

  it("is null when the hand has no size", () => {
    const lm: HandLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    expect(pinchGap(lm, 640, 480)).toBeNull();
  });

  it("tips 2 cm apart read closed; 4.5 cm apart read clearly open", () => {
    expect(gap(tipsApart(2))).toBeLessThan(PINCH_CLOSE_BELOW);
    expect(gap(tipsApart(4.5))).toBeGreaterThan(PINCH_OPEN_ABOVE);
  });
});

describe("PinchLatch: close at once below the close mark; open only after a wide gap held ~150 ms", () => {
  const FRAME_MS = 1000 / 30;

  it("has the fixed thresholds", () => {
    expect([PINCH_CLOSE_BELOW, PINCH_OPEN_ABOVE, PINCH_OPEN_HOLD_MS]).toEqual([0.25, 0.5, 150]);
  });

  it("closes on the first frame below the close mark", () => {
    const l = new PinchLatch();
    expect(l.update(1.2, 0)).toBe(0);
    expect(l.update(0.2, 33)).toBe(1);
  });

  it("one wide frame while holding never opens it", () => {
    const l = new PinchLatch();
    l.update(0.1, 0);
    expect(l.update(1.3, 33)).toBe(1); // a noisy frame
    expect(l.update(0.1, 66)).toBe(1);
    for (let t = 100; t < 2000; t += FRAME_MS) expect(l.update(Math.floor(t / FRAME_MS) % 5 === 0 ? 1.3 : 0.15, t)).toBe(1);
  });

  it("opens once the gap stays wide for 150 ms", () => {
    const l = new PinchLatch();
    l.update(0.1, 0);
    expect(l.update(0.8, 100)).toBe(1);
    expect(l.update(0.8, 200)).toBe(1);
    expect(l.update(0.8, 249)).toBe(1);
    expect(l.update(0.8, 250)).toBe(0);
  });

  it("between the marks it holds, and restarts the open timer", () => {
    const l = new PinchLatch();
    l.update(0.1, 0);
    l.update(0.8, 100);
    expect(l.update(0.35, 200)).toBe(1); // between: hold
    expect(l.update(0.8, 260)).toBe(1); // the wide gap starts again here
    expect(l.update(0.8, 400)).toBe(1);
    expect(l.update(0.8, 410)).toBe(0);
    expect(l.update(0.35, 450)).toBe(0); // open, between: stays open
  });

  it("holds with no hand, and a lost hand restarts the open timer", () => {
    const l = new PinchLatch();
    l.update(0.1, 0);
    l.update(0.9, 100);
    expect(l.update(null, 200)).toBe(1);
    expect(l.update(0.9, 260)).toBe(1);
    expect(l.update(0.9, 410)).toBe(0);
    expect(l.update(null, 500)).toBe(0);
  });

  it("a pinch closes with the palm sideways or the back of the hand to the camera; a fist does not", () => {
    for (const deg of [80, 170]) {
      const l = new PinchLatch();
      expect([deg, l.update(gap(makeHandPose({ rot: { y: rad(deg) }, thumbTip: pinchThumbTip() }).landmarks), 0)]).toEqual([deg, 1]);
    }
    expect(new PinchLatch().update(gap(makeHandPose({ flex: FIST_FLEX }).landmarks), 0)).toBe(0);
  });
});
