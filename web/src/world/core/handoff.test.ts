import { describe, expect, it } from "vitest";
import { FIRE_AT, INITIAL_HANDOFF, SCREEN_FROM, handoffStep, saveReturn, screenOpacity, takeReturn, type HandoffState } from "./handoff";
import type { Place } from "./rail";

const ZOOM = 4;
const at = (t: number, index = ZOOM, phase: Place["phase"] = "dwell"): Place => ({ index, phase, t, current: index });

function run(places: Place[], start: HandoffState = INITIAL_HANDOFF) {
  let s = start;
  const fired: number[] = [];
  places.forEach((p, i) => {
    const r = handoffStep(s, p, ZOOM);
    s = r.state;
    if (r.fire) fired.push(i);
  });
  return fired;
}

describe("handoffStep", () => {
  it("fires once when scrolling down to the end of the zoom", () => {
    expect(run([at(0.5, 0), at(0.2), at(0.6), at(0.95), at(1), at(1), at(0.999)])).toEqual([4]);
  });
  it("doesn't fire when the page opens already at the end (Back, reload)", () => {
    expect(run([at(1), at(1), at(0.95), at(1)])).toEqual([]);
  });
  it("re-arms after scrolling back up past the arm line", () => {
    expect(run([at(0.3), at(1), at(0.85), at(1)])).toEqual([1, 3]);
  });
  it("never fires outside the zoom dwell", () => {
    expect(run([at(0), at(1, 3), at(1, ZOOM, "travel")])).toEqual([]);
  });
});

describe("screenOpacity", () => {
  it("is clear until SCREEN_FROM and opaque by the time the route changes", () => {
    expect(screenOpacity(0)).toBe(0);
    expect(screenOpacity(SCREEN_FROM)).toBe(0);
    expect(screenOpacity(FIRE_AT)).toBe(1);
    expect(screenOpacity(1)).toBe(1);
    const mid = screenOpacity((SCREEN_FROM + FIRE_AT) / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});

describe("saveReturn / takeReturn", () => {
  it("remembers the station once, and survives storage that throws", () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as Storage;
    saveReturn(storage, "machine");
    expect(takeReturn(storage)).toBe("machine");
    expect(takeReturn(storage)).toBeNull();
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => {} } as unknown as Storage;
    expect(() => saveReturn(broken, "machine")).not.toThrow();
    expect(takeReturn(broken)).toBeNull();
  });
});
