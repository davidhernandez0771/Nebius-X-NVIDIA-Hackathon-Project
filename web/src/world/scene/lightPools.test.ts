// The light under the two pendant lamps: a soft pool on the floor on every tier, and on ultra the shafts
// fade out in the air. Before, the shafts ran through the floor and their rims drew dashed rings that
// flickered as the camera moved (ultra only), while low and high had no pool at all.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SHAFTS, shaftFrag } from "./Haze";
import { FLOOR_Y, POOLS, poolGeometry, poolMaterial } from "./lightPools";

describe("the lamps' pools of light on the floor", () => {
  it("one under each pendant lamp, just above the floor", () => {
    expect(POOLS).toHaveLength(2);
    POOLS.forEach((p, i) => {
      expect(p.x).toBeCloseTo(SHAFTS[i].top.x);
      expect(p.z).toBeCloseTo(SHAFTS[i].top.z);
      expect(p.radius).toBeGreaterThan(2.5);
    });
  });

  it("is one flat mesh for both, lifted off the floor, facing up", () => {
    const g = poolGeometry();
    const pos = g.getAttribute("position");
    expect(pos.count).toBe(8);
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeGreaterThan(FLOOR_Y);
      expect(pos.getY(i)).toBeLessThan(FLOOR_Y + 0.05);
    }
    g.dispose();
  });

  it("adds light softly, without writing depth or fighting the floor for it", () => {
    const m = poolMaterial();
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.depthWrite).toBe(false);
    expect(m.polygonOffset).toBe(true);
    expect(m.polygonOffsetFactor).toBeLessThan(0);
    // No hard edge: the falloff reaches zero before the quad's rim.
    expect(m.fragmentShader).toMatch(/smoothstep/);
    m.dispose();
  });
});

describe("the light shafts (ultra)", () => {
  // The dashed rings were NaN: pow() of a base a hair below 0 at the rim, spread by the bloom.
  it("never take pow() of a negative base", () => {
    const pows = [...shaftFrag.matchAll(/pow\((.+?),\s*[\d.]+\)/g)].map((m) => m[1].trim());
    expect(pows.length).toBeGreaterThan(0);
    for (const base of pows) expect(base).toMatch(/^max\(/);
  });

  it("end in the air above the floor, so their rims never cut it", () => {
    for (const s of SHAFTS) expect(s.floorY).toBeGreaterThan(FLOOR_Y + 1);
  });
});
