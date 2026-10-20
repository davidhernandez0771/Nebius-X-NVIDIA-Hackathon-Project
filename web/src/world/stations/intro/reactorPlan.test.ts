import { describe, expect, it } from "vitest";
import { CAVERN, CORE, THE_RING, TOP_RING } from "./layout";
import { cameraAt } from "./path";
import { CABLES, cableLight, cablePoint, particleSpeed, RINGS, ringPose, ringSpeed } from "./reactorPlan";
import { span } from "./storyPlan";

const axisR = (p: readonly number[]) => Math.hypot(p[0] - CAVERN.axis[0], p[2] - CAVERN.axis[1]);

describe("the cables", () => {
  it("run from the cavern's wall or ceiling to a socket on the core", () => {
    expect(CABLES.length).toBeGreaterThanOrEqual(10);
    for (const c of CABLES) {
      const a = cablePoint(c, 0);
      const b = cablePoint(c, 1);
      const onWall = Math.abs(axisR(a) - CAVERN.radius) < 1.5;
      const onCeiling = Math.abs(a[1] - CAVERN.ceiling) < 1.5;
      expect(onWall || onCeiling).toBe(true);
      expect(axisR(b)).toBeLessThan(CORE.radius + 0.6);
      expect(b[1]).toBeGreaterThan(CORE.bottom);
      expect(b[1]).toBeLessThan(CORE.top);
    }
  });

  it("hang clear of the camera as it circles the core", () => {
    const [a, b] = span("reactor");
    for (let vh = a; vh <= span("ring")[1]; vh += 0.02) {
      const cam = cameraAt(vh).position;
      for (const c of CABLES)
        for (let s = 0; s <= 1; s += 0.05) {
          const p = cablePoint(c, s);
          expect(Math.hypot(p[0] - cam[0], p[1] - cam[1], p[2] - cam[2])).toBeGreaterThan(3);
        }
    }
    expect(b).toBeGreaterThan(a);
  });

  it("light up one after another as the power climbs: a lit cable's predecessors are lit too", () => {
    const n = CABLES.length;
    for (let i = 0; i < n; i++) {
      expect(cableLight(i, n, 0)).toBe(0);
      expect(cableLight(i, n, 1)).toBe(1);
    }
    for (let p = 0; p <= 1; p += 0.01)
      for (let i = 1; i < n; i++) expect(cableLight(i - 1, n, p)).toBeGreaterThanOrEqual(cableLight(i, n, p));
    // In sequence, not all at once: halfway, some are on and some are still dark.
    const half = Array.from({ length: n }, (_, i) => cableLight(i, n, 0.5));
    expect(half.filter((v) => v === 1).length).toBeGreaterThan(1);
    expect(half.filter((v) => v === 0).length).toBeGreaterThan(1);
  });
});

describe("the rings", () => {
  it("stand round the core, under the top ring", () => {
    for (const r of RINGS) {
      expect(r.y).toBeGreaterThan(CORE.bottom);
      expect(r.y).toBeLessThan(TOP_RING.center[1]);
      expect(r.radius).toBeGreaterThan(CORE.radius + 0.8);
    }
  });

  it("spin up with the power, the particles with them", () => {
    let prev = -1;
    for (let p = 0; p <= 1; p += 0.01) {
      expect(ringSpeed(p)).toBeGreaterThanOrEqual(prev);
      prev = ringSpeed(p);
    }
    expect(ringSpeed(1)).toBeGreaterThan(ringSpeed(0.1) * 8);
    expect(particleSpeed(1)).toBeGreaterThan(particleSpeed(0) * 6);
  });

  it("lift the top ring off the core into THE RING", () => {
    expect(ringPose(0)).toEqual(TOP_RING);
    expect(ringPose(1)).toEqual(THE_RING);
    let prev = -Infinity;
    for (let l = 0; l <= 1; l += 0.01) {
      const r = ringPose(l);
      expect(r.center[1]).toBeGreaterThanOrEqual(prev);
      prev = r.center[1];
      expect(axisR(r.center)).toBeCloseTo(0, 9);
    }
  });
});
