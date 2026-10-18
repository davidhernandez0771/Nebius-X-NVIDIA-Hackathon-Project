import { describe, expect, it } from "vitest";

import { canonicalHand, makeHandPose, pinchThumbTip, type V3 } from "./__fixtures__/handPoses";
import type { TrackedHand } from "../hand/contracts";
import {
  CHANGE_FRAMES,
  DEFAULT_PINCH_CAL,
  PINCH_2D,
  PinchLatch,
  pinch3d,
  pinchThresholds,
  readPinch,
  type PinchReading,
} from "./pinch";

const rad = (d: number) => (d * Math.PI) / 180;
const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function hand(opts: Parameters<typeof makeHandPose>[0] = {}): TrackedHand {
  const { world, landmarks } = makeHandPose(opts);
  return { landmarks, worldLandmarks: world, handedness: "Right" };
}

/** A thumb tip placed so the 3D pinch reads `v` (index finger length units). */
function thumbAt(v: number): V3 {
  const c = canonicalHand();
  const len = dist(c[5], c[6]) + dist(c[6], c[7]) + dist(c[7], c[8]);
  return { ...c[8], x: c[8].x - v * len };
}

const TH = pinchThresholds(null);
const r3 = (value: number): PinchReading => ({ value, source: "3d" });

describe("pinch3d: |wl4 - wl8| over the index finger's length (5-6-7-8)", () => {
  it("is small for a pinch, large for an open hand, and scale-free", () => {
    const open = makeHandPose().world;
    const pinch = makeHandPose({ thumbTip: pinchThumbTip() }).world;
    expect(pinch3d(pinch)!).toBeLessThan(TH.closeBelow);
    expect(pinch3d(open)!).toBeGreaterThan(TH.openAbove);
    const bigger = pinch.map((p) => ({ x: p.x * 1.4, y: p.y * 1.4, z: p.z * 1.4 }));
    expect(pinch3d(bigger)!).toBeCloseTo(pinch3d(pinch)!, 9);
    expect(pinch3d(makeHandPose({ thumbTip: thumbAt(0.6) }).world)!).toBeCloseTo(0.6, 6);
  });

  it("doesn't change when the hand turns, pitches or shows its back (no palm-angle gating)", () => {
    const at = (rot: { x?: number; y?: number; z?: number }) => pinch3d(makeHandPose({ rot, thumbTip: thumbAt(0.3) }).world)!;
    for (const rot of [{ y: rad(80) }, { y: rad(170) }, { x: rad(90) }, { z: rad(45) }]) expect(at(rot)).toBeCloseTo(0.3, 6);
  });

  it("is null for a degenerate finger", () => {
    const flat = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
    expect(pinch3d(flat)).toBeNull();
  });
});

describe("readPinch", () => {
  it("uses the world landmarks when there are 21", () => {
    const r = readPinch(hand({ thumbTip: thumbAt(0.5) }), 0.9);
    expect(r.source).toBe("3d");
    expect(r.value).toBeCloseTo(0.5, 6);
  });

  it("falls back to the 2D pinch_ratio without world landmarks", () => {
    const h = hand();
    expect(readPinch({ ...h, worldLandmarks: undefined }, 0.42)).toEqual({ value: 0.42, source: "2d" });
    expect(readPinch({ ...h, worldLandmarks: h.worldLandmarks!.slice(0, 5) }, 0.42).source).toBe("2d");
  });
});

describe("pinchThresholds", () => {
  it("sit 35% and 65% of the way from pinched to open", () => {
    expect(pinchThresholds({ open: 1.2, pinched: 0.2 })).toEqual({ closeBelow: 0.55, openAbove: 0.85 });
    expect(pinchThresholds(null)).toEqual(pinchThresholds(DEFAULT_PINCH_CAL));
    expect(TH.closeBelow).toBeLessThan(TH.openAbove);
  });
});

describe("PinchLatch: hysteresis, 2 consecutive frames to change", () => {
  it(`closes after ${CHANGE_FRAMES} frames below the close threshold, opens after ${CHANGE_FRAMES} above the open one`, () => {
    expect(CHANGE_FRAMES).toBe(2);
    const l = new PinchLatch();
    expect(l.update(r3(1), TH)).toBe(0);
    expect(l.update(r3(0.1), TH)).toBe(0);
    expect(l.update(r3(0.1), TH)).toBe(1);
    expect(l.update(r3(1), TH)).toBe(1);
    expect(l.update(r3(1), TH)).toBe(0);
  });

  it("ignores a one-frame blip", () => {
    const l = new PinchLatch();
    for (const v of [1, 0.1, 1, 0.1, 1]) expect(l.update(r3(v), TH)).toBe(0);
  });

  it("holds between the thresholds", () => {
    const l = new PinchLatch();
    l.update(r3(0.1), TH);
    l.update(r3(0.1), TH);
    const mid = (TH.closeBelow + TH.openAbove) / 2;
    for (let i = 0; i < 5; i++) expect(l.update(r3(mid), TH)).toBe(1);
  });

  it("holds while the hand is lost, and the lost frame breaks a streak", () => {
    const l = new PinchLatch();
    l.update(r3(0.1), TH);
    expect(l.update(null, TH)).toBe(0);
    expect(l.update(r3(0.1), TH)).toBe(0); // the streak restarted
    expect(l.update(r3(0.1), TH)).toBe(1);
    expect(l.update(null, TH)).toBe(1);
  });

  it("2D readings use the sim's 2D thresholds, whatever the 3D calibration", () => {
    const l = new PinchLatch();
    const tight = pinchThresholds({ open: 3, pinched: 2 }); // 3D: closes below 2.35
    const twoD = (value: number): PinchReading => ({ value, source: "2d" });
    l.update(twoD(PINCH_2D.closeBelow + 0.05), tight);
    expect(l.update(twoD(PINCH_2D.closeBelow + 0.05), tight)).toBe(0);
    l.update(twoD(PINCH_2D.closeBelow - 0.05), tight);
    expect(l.update(twoD(PINCH_2D.closeBelow - 0.05), tight)).toBe(1);
  });

  it("a pinch closes whatever the hand's rotation: no freeze", () => {
    const l = new PinchLatch();
    for (const rot of [{ y: rad(80) }, { y: rad(170) }]) {
      const latch = new PinchLatch();
      const h = hand({ rot, thumbTip: pinchThumbTip() });
      latch.update(readPinch(h, 1), TH);
      expect(latch.update(readPinch(h, 1), TH)).toBe(1);
    }
    expect(l.state).toBe(0);
  });
});
