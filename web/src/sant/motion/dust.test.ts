import { describe, expect, it } from "vitest";
import { dustPoint, makeDust, sampleMask, seeded, type DustTiming } from "./dust";

const TIMING: DustTiming = { at: 100, duration: 600, stagger: 140, fade: 200 };

describe("seeded", () => {
  it("repeats for the same seed and stays in [0, 1)", () => {
    const a = seeded(7);
    const b = seeded(7);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("sampleMask", () => {
  it("keeps the opaque pixels on a grid step", () => {
    const width = 4;
    const height = 2;
    const data = new Uint8ClampedArray(width * height * 4);
    // Opaque pixels at (0,0) and (2,1).
    data[3] = 255;
    data[(1 * width + 2) * 4 + 3] = 255;
    expect(sampleMask({ width, height, data }, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 1 },
    ]);
    // Step 2 only visits rows 0, 2, …, so the pixel on row 1 is skipped.
    expect(sampleMask({ width, height, data }, 2)).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("dust", () => {
  const targets = [
    [{ x: 100, y: 100 }],
    [{ x: 200, y: 100 }],
  ];
  const dust = makeDust(targets, { width: 1000, height: 800, seed: 1 });

  it("makes a particle for every target, tagged with its unit", () => {
    expect(dust.map((p) => p.unit)).toEqual([0, 1]);
  });

  it("lands each unit's dust one stagger after the last, exactly on target", () => {
    for (const p of dust) {
      const land = TIMING.at + TIMING.duration + p.unit * TIMING.stagger;
      const at = dustPoint(p, land, TIMING);
      expect(at.x).toBeCloseTo(p.tx);
      expect(at.y).toBeCloseTo(p.ty);
      expect(at.alpha).toBeCloseTo(1);
    }
  });

  it("is away from its target before gathering", () => {
    const p = dust[0];
    const at = dustPoint(p, 0, TIMING);
    expect(Math.hypot(at.x - p.tx, at.y - p.ty)).toBeGreaterThan(1);
  });

  it("fades out once landed, as the letter takes over", () => {
    const p = dust[1];
    const land = TIMING.at + TIMING.duration + p.unit * TIMING.stagger;
    expect(dustPoint(p, land + TIMING.fade, TIMING).alpha).toBe(0);
    expect(dustPoint(p, land + TIMING.fade / 2, TIMING).alpha).toBeCloseTo(0.5);
  });

  it("gets steadily closer to its target while gathering", () => {
    const p = dust[0];
    const d = [200, 350, 500, 700].map((t) => {
      const at = dustPoint(p, t, TIMING);
      return Math.hypot(at.x - p.tx, at.y - p.ty);
    });
    expect(d[3]).toBeCloseTo(0);
    expect(d[2]).toBeLessThan(d[0]);
  });
});
