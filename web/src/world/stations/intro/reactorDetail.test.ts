import { describe, expect, it } from "vitest";
import { CAVERN, CORE } from "./layout";
import { cameraAt } from "./path";
import {
  CABLES,
  cableFront,
  cableLight,
  cablePoint,
  CLAMPS_PER_CABLE,
  clampsOf,
  CORE_PANELS,
  JUNCTIONS,
  pulseSpeed,
  RING_BOLTS,
  sparkRate,
} from "./reactorPlan";
import { span } from "./storyPlan";

const axisR = (p: readonly number[]) => Math.hypot(p[0] - CAVERN.axis[0], p[2] - CAVERN.axis[1]);

describe("the reactor's cables, in detail", () => {
  it("are twice as many, run in groups from junction boxes on the wall", () => {
    expect(CABLES.length).toBeGreaterThanOrEqual(28);
    expect(JUNCTIONS.length).toBeGreaterThanOrEqual(6);
    for (const j of JUNCTIONS) expect(Math.abs(axisR(j.pos) - CAVERN.radius)).toBeLessThan(1.5);
    for (const c of CABLES) {
      const box = JUNCTIONS[c.junction];
      const a = cablePoint(c, 0);
      expect(Math.hypot(a[0] - box.pos[0], a[1] - box.pos[1], a[2] - box.pos[2])).toBeLessThan(1.2);
    }
    // Every box feeds several.
    for (let j = 0; j < JUNCTIONS.length; j++) expect(CABLES.filter((c) => c.junction === j).length).toBeGreaterThanOrEqual(3);
  });

  it("sag between the wall and the core and stay clear of the camera as it circles", () => {
    for (const c of CABLES) {
      const a = cablePoint(c, 0);
      const b = cablePoint(c, 1);
      const lowest = Math.min(...Array.from({ length: 21 }, (_, k) => cablePoint(c, k / 20)[1]));
      expect(lowest).toBeLessThan(Math.min(a[1], b[1]));
      expect(lowest).toBeGreaterThan(CAVERN.floor);
    }
    const [a] = span("reactor");
    for (let vh = a; vh <= span("ring")[1]; vh += 0.05) {
      const cam = cameraAt(vh).position;
      for (const c of CABLES)
        for (let s = 0; s <= 1; s += 0.05) {
          const p = cablePoint(c, s);
          expect(Math.hypot(p[0] - cam[0], p[1] - cam[1], p[2] - cam[2])).toBeGreaterThan(3);
        }
    }
  });

  it("are held by clamps along their length, on the cable, with its direction", () => {
    for (const c of CABLES) {
      const clamps = clampsOf(c);
      expect(clamps).toHaveLength(CLAMPS_PER_CABLE);
      for (const k of clamps) {
        const p = cablePoint(c, k.s);
        expect(k.pos).toEqual(p);
        expect(Math.hypot(...k.dir)).toBeCloseTo(1, 6);
        expect(k.s).toBeGreaterThan(0.08);
        expect(k.s).toBeLessThan(0.92);
      }
    }
  });

  it("fill with light from the wall to the core as the power climbs, in order, and empty again on the way back", () => {
    const n = CABLES.length;
    for (let i = 0; i < n; i++) {
      expect(cableFront(i, n, 0)).toBe(0);
      expect(cableFront(i, n, 1)).toBe(1);
      let prev = 0;
      for (let p = 0; p <= 1; p += 0.01) {
        const f = cableFront(i, n, p);
        expect(f).toBeGreaterThanOrEqual(prev);
        prev = f;
        // The front leads the brightness: a cable is never lit beyond its front.
        if (cableLight(i, n, p) > 0.5) expect(f).toBeGreaterThan(0.5);
      }
    }
    for (let p = 0; p <= 1; p += 0.05)
      for (let i = 1; i < n; i++) expect(cableFront(i - 1, n, p)).toBeGreaterThanOrEqual(cableFront(i, n, p));
  });

  it("send pulses faster as the power climbs", () => {
    let prev = -1;
    for (let p = 0; p <= 1; p += 0.05) {
      expect(pulseSpeed(p)).toBeGreaterThan(prev);
      prev = pulseSpeed(p);
    }
  });
});

describe("the core and the sparks", () => {
  it("has panels round the core and bolts on every ring", () => {
    expect(CORE_PANELS).toBeGreaterThanOrEqual(10);
    expect(RING_BOLTS).toBeGreaterThanOrEqual(12);
    expect(CORE.radius).toBeGreaterThan(0);
  });

  it("throws sparks only near full power, most as the top ring lifts", () => {
    expect(sparkRate(0.5, 0)).toBe(0);
    expect(sparkRate(0.85, 0)).toBe(0);
    expect(sparkRate(1, 0)).toBeGreaterThan(0);
    expect(sparkRate(1, 1)).toBeGreaterThan(sparkRate(1, 0));
    expect(sparkRate(1, 1)).toBeLessThanOrEqual(1);
  });
});
