import { describe, expect, it } from "vitest";
import { DUST, LOGO, LOGO_SCALE, ROOF, SKYLIGHT } from "./layout";
import { dustBuffers, logoBuffers, roofPoint, sampleMark, seeded } from "./particles";

describe("sampleMark", () => {
  it("keeps the opaque pixels, centred and y up", () => {
    // 4 x 2 RGBA: only (3, 0) is opaque.
    const data = new Uint8ClampedArray(4 * 2 * 4);
    data[(0 * 4 + 3) * 4 + 3] = 255;
    expect([...sampleMark(data, 4, 2)]).toEqual([1, 1]);
  });
});

describe("the roof lattice", () => {
  it("stays over the ceiling and inside the room", () => {
    const rnd = seeded(3);
    for (let i = 0; i < 2000; i++) {
      const [x, y, z] = roofPoint(rnd);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(ROOF.radius + 1e-6);
      expect(y).toBeGreaterThan(14.4);
      expect(y).toBeLessThan(ROOF.y + ROOF.rise + 0.1);
      // The room runs to z = 13 at the open front.
      expect(z).toBeLessThan(13);
    }
  });

  it("has some of its points inside the skylight, so the roof shows from the room", () => {
    const rnd = seeded(5);
    let inside = 0;
    for (let i = 0; i < 2000; i++) {
      const [x, , z] = roofPoint(rnd);
      if (Math.hypot(x, z) < SKYLIGHT.radius) inside++;
    }
    expect(inside).toBeGreaterThan(50);
  });
});

describe("logoBuffers", () => {
  it("makes n points with roof targets that land on the lattice in world space", () => {
    const mark = new Float32Array([0, 0, 10, 10, -10, 5]);
    const b = logoBuffers(mark, 500);
    expect(b.position).toHaveLength(1500);
    expect(b.roof).toHaveLength(1500);
    expect(b.rand).toHaveLength(2000);
    for (let i = 0; i < 500; i++) {
      const wy = b.roof[i * 3 + 1] * LOGO_SCALE + LOGO[1];
      expect(wy).toBeGreaterThan(14.4);
    }
    expect(logoBuffers(mark, 500).position).toEqual(b.position);
  });

  it("still makes plumes when the mark is empty", () => {
    const b = logoBuffers(new Float32Array(0), 100);
    expect(b.position.every(Number.isFinite)).toBe(true);
  });
});

describe("dustBuffers", () => {
  it("fills the column", () => {
    const d = dustBuffers(1000);
    for (let i = 0; i < 1000; i++) {
      expect(Math.hypot(d.position[i * 3], d.position[i * 3 + 2])).toBeLessThanOrEqual(DUST.radius);
      expect(d.position[i * 3 + 1]).toBeGreaterThanOrEqual(DUST.y0);
      expect(d.position[i * 3 + 1]).toBeLessThanOrEqual(DUST.y0 + DUST.height);
    }
  });
});
