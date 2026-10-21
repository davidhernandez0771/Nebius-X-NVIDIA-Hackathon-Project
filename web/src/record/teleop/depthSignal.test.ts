import { describe, expect, it } from "vitest";
import { FRAME, makeHandPose } from "./__fixtures__/handPoses";
import { pinchingHand } from "./__fixtures__/pinchTrace";
import { DepthAnchor, HOLD_MAX_MS, SETTLE_MS, stableSize } from "./depthSignal";
import { PINCH_CLOSE_BELOW, PINCH_OPEN_ABOVE } from "./pinch";

const project = (pts: { x: number; y: number; z: number }[], distance = 0.5) =>
  pts.map((q) => ({ x: 0.5 + (FRAME.focalPx * q.x) / (distance + q.z) / FRAME.w, y: 0.5 + (FRAME.focalPx * q.y) / (distance + q.z) / FRAME.h, z: 0 }));
const palm = (lm: { x: number; y: number }[]) => Math.hypot((lm[5].x - lm[17].x) * FRAME.w, (lm[5].y - lm[17].y) * FRAME.h) / FRAME.w;

describe("stableSize", () => {
  it("is in palm-width units: about the palm width for an open hand facing the camera", () => {
    const lm = makeHandPose().landmarks;
    expect(stableSize(lm, FRAME.w, FRAME.h)! / palm(lm)).toBeCloseTo(1, 1);
  });

  it("goes as 1 / distance, like the palm width", () => {
    const near = stableSize(makeHandPose({ distance: 0.4 }).landmarks, FRAME.w, FRAME.h)!;
    const far = stableSize(makeHandPose({ distance: 0.6 }).landmarks, FRAME.w, FRAME.h)!;
    expect(near / far).toBeCloseTo(1.5, 1);
  });

  it("barely moves when the knuckles narrow in a pinch, where the knuckle span drops ~13%", () => {
    const open = project(pinchingHand(0));
    const pinched = project(pinchingHand(1));
    expect(palm(pinched) / palm(open)).toBeLessThan(0.9);
    const ratio = stableSize(pinched, FRAME.w, FRAME.h)! / stableSize(open, FRAME.w, FRAME.h)!;
    expect(Math.abs(1 - ratio)).toBeLessThan(0.025);
  });

  it("is null for a collapsed hand", () => {
    const lm = makeHandPose().landmarks.map(() => ({ x: 0.5, y: 0.5, z: 0 }));
    expect(stableSize(lm, FRAME.w, FRAME.h)).toBeNull();
  });
});

describe("DepthAnchor", () => {
  const OPEN_GAP = PINCH_OPEN_ABOVE + 0.3;
  const MID_GAP = (PINCH_CLOSE_BELOW + PINCH_OPEN_ABOVE) / 2;
  const SHUT_GAP = PINCH_CLOSE_BELOW - 0.1;
  /** Feed frames every 33 ms from t0 while t < t1; returns the last output and the next t. */
  const feed = (a: DepthAnchor, t0: number, t1: number, size: number, gap: number | null, g: 0 | 1) => {
    let out: number | null = null;
    let t = t0;
    for (; t < t1; t += 33) out = a.update(t, size, gap, g);
    return { out, t };
  };

  it("passes the size through while nothing happens", () => {
    const a = new DepthAnchor();
    expect(a.update(0, 0.1, OPEN_GAP, 0)).toBe(0.1);
    expect(a.update(33, 0.12, OPEN_GAP, 0)).toBe(0.12);
  });

  it("holds the level from before the pinch, through the pinch and the settle, then continues from it", () => {
    const a = new DepthAnchor();
    let { t } = feed(a, 0, 400, 0.1, OPEN_GAP, 0);
    expect(a.update(t, 0.095, MID_GAP, 0)).toBe(0.1); // thumb on its way: held
    expect(a.update((t += 33), 0.09, SHUT_GAP, 1)).toBeCloseTo(0.1); // closed: still held while it settles
    ({ t } = feed(a, t + 33, t + 33 + SETTLE_MS + 33, 0.09, SHUT_GAP, 1));
    expect(a.update(t, 0.09, SHUT_GAP, 1)).toBeCloseTo(0.1); // the pinched size now reads as the old level
    expect(a.update(t + 33, 0.099, SHUT_GAP, 1)).toBeCloseTo(0.11); // real motion after it: +10%
  });

  it("takes medians, not single frames, so one noisy frame at a toggle is not locked in", () => {
    const a = new DepthAnchor();
    let { t } = feed(a, 0, 400, 0.1, OPEN_GAP, 0);
    a.update(t, 0.13, OPEN_GAP, 0); // one outlier just before the pinch
    a.update((t += 33), 0.1, SHUT_GAP, 1); // closes
    a.update((t += 33), 0.07, SHUT_GAP, 1); // and one right after
    ({ t } = feed(a, t + 33, t + 33 + SETTLE_MS + 66, 0.1, SHUT_GAP, 1));
    expect(a.update(t, 0.1, SHUT_GAP, 1)).toBeCloseTo(0.1, 6);
  });

  it("re-anchors on every toggle, open as well as close, with no pinch evidence too (the spacebar)", () => {
    const a = new DepthAnchor();
    let { t } = feed(a, 0, 400, 0.1, null, 1);
    ({ t } = feed(a, t, t + SETTLE_MS + 66, 0.108, null, 0));
    expect(a.update(t, 0.108, null, 0)).toBeCloseTo(0.1);
  });

  it("gives up a hold that never ends in a toggle, without a jump", () => {
    const a = new DepthAnchor();
    let { t } = feed(a, 0, 400, 0.1, OPEN_GAP, 0);
    ({ t } = feed(a, t, t + HOLD_MAX_MS + SETTLE_MS + 99, 0.12, MID_GAP, 0)); // a relaxed hand, thumb near the index
    expect(a.update(t, 0.12, MID_GAP, 0)).toBeCloseTo(0.1); // released, continuous
    expect(a.update(t + 33, 0.132, MID_GAP, 0)).toBeCloseTo(0.11); // and follows again (no new hold in the same band)
  });

  it("passes null through and keeps its anchor across a lost hand", () => {
    const a = new DepthAnchor();
    let { t } = feed(a, 0, 400, 0.1, OPEN_GAP, 0);
    ({ t } = feed(a, t, t + SETTLE_MS + 66, 0.09, SHUT_GAP, 1));
    expect(a.update(t, null, null, 1)).toBeNull();
    expect(a.update(t + 33, 0.09, SHUT_GAP, 1)).toBeCloseTo(0.1);
  });
});
