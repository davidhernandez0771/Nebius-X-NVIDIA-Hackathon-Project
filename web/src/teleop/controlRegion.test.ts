import { describe, expect, it } from "vitest";

import { DEFAULT_CONTROL_REGION, type HandLandmark } from "../hand/contracts";
import {
  DEFAULT_TELEOP_CONTROL,
  TELEOP_CONTROL_STORAGE_KEY,
  TeleopCalibrator,
  depthFraction,
  loadTeleopControl,
  palmCenter,
  regionFraction,
  sanitizeTeleopControl,
  saveTeleopControl,
  toControl,
  type TeleopControlSettings,
} from "./controlRegion";

function landmarks(points: Record<number, [number, number]>): HandLandmark[] {
  const lm: HandLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [i, [x, y]] of Object.entries(points)) lm[Number(i)] = { x, y, z: 0 };
  return lm;
}

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe("palmCenter", () => {
  it("is the mean of landmarks 0, 5, 9 and 17, not the wrist", () => {
    const lm = landmarks({ 0: [0.5, 0.8], 5: [0.4, 0.6], 9: [0.5, 0.58], 17: [0.6, 0.62], 8: [0.1, 0.1] });
    const c = palmCenter(lm);
    expect(c.x).toBeCloseTo(0.5, 12);
    expect(c.y).toBeCloseTo((0.8 + 0.6 + 0.58 + 0.62) / 4, 12);
  });
});

describe("regionFraction (SANT's mapping, steps 1-2: remap into the region, then clamp)", () => {
  const r = { centerX: 0.5, centerY: 0.4, width: 0.5, height: 0.4 };
  it("maps the region's corners to 0 and 1", () => {
    expect(regionFraction({ x: 0.25, y: 0.2 }, r)).toEqual([0, 0]);
    expect(regionFraction({ x: 0.75, y: 0.6 }, r)[0]).toBeCloseTo(1, 12);
    expect(regionFraction({ x: 0.75, y: 0.6 }, r)[1]).toBeCloseTo(1, 12);
    expect(regionFraction({ x: 0.5, y: 0.4 }, r)).toEqual([0.5, 0.5]);
  });
  it("clamps points outside the region and does not mirror", () => {
    expect(regionFraction({ x: 0.0, y: 0.95 }, r)).toEqual([0, 1]);
    expect(regionFraction({ x: 0.3, y: 0.4 }, r)[0]).toBeCloseTo(0.1, 12); // raw left stays small
  });
});

describe("depthFraction", () => {
  it("is 0 far, 1 near, clamped", () => {
    expect(depthFraction(0.07, 0.07, 0.13)).toBe(0);
    expect(depthFraction(0.1, 0.07, 0.13)).toBeCloseTo(0.5, 12);
    expect(depthFraction(0.5, 0.07, 0.13)).toBe(1);
    expect(depthFraction(0.0, 0.07, 0.13)).toBe(0);
  });
});

describe("defaults", () => {
  it("reuse SANT's region size, centered horizontally, with the bottom edge well above the frame bottom", () => {
    const r = DEFAULT_TELEOP_CONTROL.region;
    expect(r.width).toBe(DEFAULT_CONTROL_REGION.width);
    expect(r.height).toBe(DEFAULT_CONTROL_REGION.height);
    expect(r.centerX).toBe(0.5);
    const bottom = r.centerY + r.height / 2;
    expect(bottom).toBeLessThanOrEqual(0.72);
    expect(bottom).toBeGreaterThan(0.6);
    expect(r.centerY - r.height / 2).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_TELEOP_CONTROL.depthFar).toBeLessThan(DEFAULT_TELEOP_CONTROL.depthNear);
    expect(DEFAULT_TELEOP_CONTROL.enabled).toBe(true);
  });
});

describe("toControl", () => {
  const s: TeleopControlSettings = { ...DEFAULT_TELEOP_CONTROL, region: { centerX: 0.5, centerY: 0.5, width: 0.5, height: 0.5 } };
  const lm = landmarks({ 0: [0.3, 0.3], 5: [0.3, 0.3], 9: [0.3, 0.3], 17: [0.3, 0.3] });

  it("gives [u, v, depth] in [0, 1], raw orientation", () => {
    const [u, v, d] = toControl(lm, 0.1, s);
    expect(u).toBeCloseTo(0.1, 12);
    expect(v).toBeCloseTo(0.1, 12);
    expect(d).toBeCloseTo(0.5, 12);
  });
  it("applies invert left-right and up-down", () => {
    const [u, v] = toControl(lm, 0.1, { ...s, invertX: true, invertY: true });
    expect(u).toBeCloseTo(0.9, 12);
    expect(v).toBeCloseTo(0.9, 12);
  });
});

describe("sanitizeTeleopControl", () => {
  it("falls back to defaults for junk", () => {
    expect(sanitizeTeleopControl(null)).toEqual(DEFAULT_TELEOP_CONTROL);
    expect(sanitizeTeleopControl({ region: "x", depthFar: "a" })).toEqual(DEFAULT_TELEOP_CONTROL);
  });
  it("keeps the region inside the frame and the size in range", () => {
    const s = sanitizeTeleopControl({ region: { centerX: 0.5, centerY: 0.95, width: 3, height: 0.01 } });
    expect(s.region.width).toBeLessThanOrEqual(0.9);
    expect(s.region.height).toBeGreaterThanOrEqual(0.15);
    expect(s.region.centerY + s.region.height / 2).toBeLessThanOrEqual(1);
  });
  it("rejects a depth range with far >= near", () => {
    const s = sanitizeTeleopControl({ depthFar: 0.2, depthNear: 0.1 });
    expect([s.depthFar, s.depthNear]).toEqual([DEFAULT_TELEOP_CONTROL.depthFar, DEFAULT_TELEOP_CONTROL.depthNear]);
  });
  it("keeps valid flags", () => {
    const s = sanitizeTeleopControl({ ...DEFAULT_TELEOP_CONTROL, invertX: true, enabled: false });
    expect(s.invertX).toBe(true);
    expect(s.enabled).toBe(false);
  });
});

describe("load/save", () => {
  it("round-trips under its own key, not SANT's", () => {
    const store = new MemoryStorage();
    const s = { ...DEFAULT_TELEOP_CONTROL, invertY: true, depthNear: 0.15 };
    saveTeleopControl(s, store);
    expect(TELEOP_CONTROL_STORAGE_KEY).toBe("pm.teleop.region");
    expect([...store.data.keys()]).toEqual(["pm.teleop.region"]);
    expect(loadTeleopControl(store)).toEqual(s);
  });
  it("survives broken JSON and a throwing storage", () => {
    const store = new MemoryStorage();
    store.setItem(TELEOP_CONTROL_STORAGE_KEY, "{nope");
    expect(loadTeleopControl(store)).toEqual(DEFAULT_TELEOP_CONTROL);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadTeleopControl(throwing)).toEqual(DEFAULT_TELEOP_CONTROL);
    expect(() => saveTeleopControl(DEFAULT_TELEOP_CONTROL, throwing)).not.toThrow();
  });
});

describe("TeleopCalibrator", () => {
  const opts = { moveMs: 1000, holdMs: 500, settleMs: 200 };
  const sample = (t: number, x: number, y: number, palmWidth: number) => ({ t, center: { x, y }, palmWidth });

  function runMove(cal: TeleopCalibrator, t0: number, xs: [number, number], ys: [number, number]) {
    let state = cal.push(sample(t0, 0.5, 0.5, 0.1));
    // Stop at the step change, like a user who follows the prompt (frames are continuous in real use).
    for (let t = t0; t <= t0 + 1000 && state.step === "move"; t += 20) {
      const k = (t - t0) / 1000;
      state = cal.push(sample(t, xs[0] + (xs[1] - xs[0]) * k, ys[0] + (ys[1] - ys[0]) * k, 0.1));
    }
    return state;
  }
  function runHold(cal: TeleopCalibrator, t0: number, width: number) {
    let state = cal.push(sample(t0, 0.5, 0.5, width));
    const step = state.step;
    for (let t = t0; t <= t0 + 800 && state.step === step; t += 20) state = cal.push(sample(t, 0.5, 0.5, width));
    return state;
  }

  it("steps move -> near -> far -> done and derives the region and depth range", () => {
    const cal = new TeleopCalibrator(opts);
    expect(runMove(cal, 0, [0.35, 0.65], [0.3, 0.7]).step).toBe("near");
    expect(runHold(cal, 2000, 0.16).step).toBe("far");
    const done = runHold(cal, 4000, 0.08);
    expect(done.step).toBe("done");
    const r = done.result!;
    // SANT's rule: uniform size from the larger half-span, centerX 0.5, centerY the middle of the reach.
    expect(r.region.centerX).toBe(0.5);
    expect(r.region.width).toBeCloseTo(0.4 * 1.05, 6);
    expect(r.region.height).toBe(r.region.width);
    expect(r.region.centerY).toBeCloseTo(0.5, 6);
    expect(r.depthNear).toBeLessThan(0.16);
    expect(r.depthFar).toBeGreaterThan(0.08);
    expect(r.depthFar).toBeLessThan(r.depthNear);
  });

  it("reports progress within a step", () => {
    const cal = new TeleopCalibrator(opts);
    cal.push(sample(0, 0.5, 0.5, 0.1));
    expect(cal.push(sample(500, 0.5, 0.5, 0.1)).progress).toBeCloseTo(0.5, 6);
  });

  it("fails when the hand was never seen", () => {
    const cal = new TeleopCalibrator(opts);
    let state = cal.push({ t: 0, center: null, palmWidth: 0 });
    for (let t = 0; t <= 1200; t += 20) state = cal.push({ t, center: null, palmWidth: 0 });
    expect(state.step).toBe("failed");
    expect(state.error).toMatch(/hand/i);
  });

  it("fails when near and far are too similar", () => {
    const cal = new TeleopCalibrator(opts);
    runMove(cal, 0, [0.35, 0.65], [0.3, 0.7]);
    runHold(cal, 2000, 0.1);
    const state = runHold(cal, 4000, 0.098);
    expect(state.step).toBe("failed");
    expect(state.error).toMatch(/closer|near|far/i);
  });
});
