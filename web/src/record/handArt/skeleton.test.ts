import { describe, expect, it } from "vitest";
import type { HandLandmark } from "../../hand/contracts";
import { HAND_BONES, JOINT_COUNT, handScale, packSkeleton } from "./skeleton";

const flatHand = (): HandLandmark[] =>
  Array.from({ length: 21 }, (_, i) => ({ x: 0.3 + (i % 5) * 0.05, y: 0.8 - Math.floor(i / 5) * 0.1, z: -0.01 * i }));

describe("HAND_BONES", () => {
  it("connects all 21 MediaPipe landmarks with 21 bones", () => {
    expect(HAND_BONES).toHaveLength(21);
    const used = new Set(HAND_BONES.flat());
    expect(used.size).toBe(JOINT_COUNT);
    for (const [a, b] of HAND_BONES) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(21);
    }
  });
});

describe("handScale", () => {
  it("is the wrist to middle-knuckle length in aspect-corrected units", () => {
    const lm = flatHand();
    lm[0] = { x: 0.5, y: 0.8, z: 0 };
    lm[9] = { x: 0.5, y: 0.5, z: 0 };
    expect(handScale(lm, 4 / 3)).toBeCloseTo(0.3);
    lm[9] = { x: 0.8, y: 0.8, z: 0 };
    expect(handScale(lm, 4 / 3)).toBeCloseTo(0.4); // x is stretched by the aspect
  });
});

describe("packSkeleton", () => {
  it("returns null for a missing or malformed hand", () => {
    expect(packSkeleton(null, { aspect: 1, mirrored: false })).toBeNull();
    expect(packSkeleton(flatHand().slice(0, 20), { aspect: 1, mirrored: false })).toBeNull();
    const bad = flatHand();
    bad[3] = { x: Number.NaN, y: 0, z: 0 };
    expect(packSkeleton(bad, { aspect: 1, mirrored: false })).toBeNull();
  });

  it("packs joints as (x*aspect, 1-y, radius, z) and bones as segment endpoints", () => {
    const lm = flatHand();
    const p = packSkeleton(lm, { aspect: 2, mirrored: false })!;
    expect(p.joints).toHaveLength(21 * 4);
    expect(p.bones).toHaveLength(21 * 4);
    expect(p.joints[0]).toBeCloseTo(lm[0].x * 2);
    expect(p.joints[1]).toBeCloseTo(1 - lm[0].y); // GL uv has y up
    expect(p.joints[3]).toBeCloseTo(lm[0].z);
    const [a, b] = HAND_BONES[4];
    expect(p.bones[16]).toBeCloseTo(lm[a].x * 2);
    expect(p.bones[17]).toBeCloseTo(1 - lm[a].y);
    expect(p.bones[18]).toBeCloseTo(lm[b].x * 2);
    expect(p.bones[19]).toBeCloseTo(1 - lm[b].y);
  });

  it("mirrors x like a mirror (u -> 1-u) when asked", () => {
    const lm = flatHand();
    const p = packSkeleton(lm, { aspect: 1, mirrored: true })!;
    expect(p.joints[0]).toBeCloseTo(1 - lm[0].x);
  });

  it("sizes fingertips larger than knuckles, both in proportion to the hand", () => {
    const lm = flatHand();
    const p = packSkeleton(lm, { aspect: 1, mirrored: false })!;
    const radius = (i: number) => p.joints[i * 4 + 2];
    expect(radius(8)).toBeGreaterThan(radius(6));
    expect(p.boneRadius).toBeGreaterThan(0);
    const big = packSkeleton(
      lm.map((q) => ({ x: 0.5 + (q.x - 0.5) * 2, y: 0.5 + (q.y - 0.5) * 2, z: q.z })),
      { aspect: 1, mirrored: false },
    )!;
    expect(big.boneRadius).toBeCloseTo(p.boneRadius * 2);
  });
});
