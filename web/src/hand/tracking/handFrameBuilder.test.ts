import { describe, expect, it } from "vitest";
import { buildTrackedHands } from "./handFrameBuilder";

function landmark(x: number, y: number, z = 0) {
  return { x, y, z };
}

function hand21(seed: number) {
  return Array.from({ length: 21 }, (_, i) => landmark(seed + i * 0.01, seed + i * 0.01));
}

describe("buildTrackedHands", () => {
  it("returns an empty array when no hands are detected", () => {
    expect(buildTrackedHands([], [])).toEqual([]);
  });

  it("maps a single hand's landmarks and handedness through unchanged", () => {
    const result = buildTrackedHands(
      [hand21(0.1)],
      [[{ categoryName: "Right" }]],
    );
    expect(result).toHaveLength(1);
    expect(result[0].handedness).toBe("Right");
    expect(result[0].landmarks).toHaveLength(21);
    expect(result[0].landmarks[0]).toEqual({ x: 0.1, y: 0.1, z: 0 });
  });

  it("preserves detector array order across two hands without sorting", () => {
    const result = buildTrackedHands(
      [hand21(0.9), hand21(0.1)],
      [[{ categoryName: "Left" }], [{ categoryName: "Right" }]],
    );
    expect(result).toHaveLength(2);
    expect(result[0].handedness).toBe("Left");
    expect(result[0].landmarks[0].x).toBeCloseTo(0.9);
    expect(result[1].handedness).toBe("Right");
    expect(result[1].landmarks[0].x).toBeCloseTo(0.1);
  });

  it("maps an unrecognized or missing handedness category to null", () => {
    const withUnknown = buildTrackedHands([hand21(0.2)], [[{ categoryName: "Unknown" }]]);
    expect(withUnknown[0].handedness).toBeNull();

    const withMissing = buildTrackedHands([hand21(0.2)], [[]]);
    expect(withMissing[0].handedness).toBeNull();
  });

  it("drops extra fields from the raw landmark (structural input, e.g. MediaPipe's visibility)", () => {
    const result = buildTrackedHands(
      [[{ x: 0.5, y: 0.5, z: 0.1, visibility: 0.99 } as any]],
      [[{ categoryName: "Left" }]],
    );
    expect(result[0].landmarks[0]).toEqual({ x: 0.5, y: 0.5, z: 0.1 });
  });
});
