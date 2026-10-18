import { describe, expect, it } from "vitest";
import { TONES, xrayPixels } from "./xray";

function frame(w: number, h: number, paint: (x: number, y: number) => [number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      d.set([r, g, b, 255], (y * w + x) * 4);
    }
  return d;
}

describe("xrayPixels", () => {
  // A white sim floor with a red cube at x 4..7, y 2..5.
  const isCube = (x: number, y: number) => x >= 4 && x <= 7 && y >= 2 && y <= 5;
  const src = frame(12, 10, (x, y) => (isCube(x, y) ? [220, 40, 40] : [245, 245, 245]));

  it("turns the bright floor dark", () => {
    const { data } = xrayPixels(src, 12, 10, TONES.raw);
    expect(data[(9 * 12 + 0) * 4]).toBeLessThan(40);
  });

  it("finds the red cube's box and paints it in the side's colour", () => {
    const { data, cube } = xrayPixels(src, 12, 10, TONES.raw);
    expect(cube).toEqual({ x0: 4, y0: 2, x1: 7, y1: 5 });
    expect(Array.from(data.slice((3 * 12 + 5) * 4, (3 * 12 + 5) * 4 + 3))).toEqual(TONES.raw.cube);
    expect(Array.from(xrayPixels(src, 12, 10, TONES.perfected).data.slice((3 * 12 + 5) * 4, (3 * 12 + 5) * 4 + 3))).toEqual(
      TONES.perfected.cube,
    );
  });

  it("reports no cube when none is in view", () => {
    expect(xrayPixels(frame(4, 4, () => [245, 245, 245]), 4, 4, TONES.raw).cube).toBeNull();
  });
});
