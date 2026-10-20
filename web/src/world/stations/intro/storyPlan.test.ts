import { describe, expect, it } from "vitest";
import { BEATS, beatSpan, beatState, cameraAt, INTRO_VH, logoPose, PLAN } from "./storyPlan";

describe("the intro's story plan", () => {
  it("is the hero, four beats and the morph into the ring, end to end", () => {
    expect(BEATS).toBe(5);
    expect(beatSpan(0)).toEqual([0, PLAN.hero]);
    for (let i = 1; i < BEATS; i++) expect(beatSpan(i)[0]).toBeCloseTo(beatSpan(i - 1)[1], 9);
    expect(beatSpan(BEATS - 1)[1] + PLAN.morph).toBeCloseTo(INTRO_VH, 9);
  });

  it("shows one beat at a time: the next one starts in only once the last has gone", () => {
    for (let vh = 0; vh <= INTRO_VH; vh += 0.02) {
      const live = Array.from({ length: BEATS }, (_, i) => beatState(vh, i)).filter((s) => s.shown > 0.01);
      expect(live.length).toBeLessThanOrEqual(1);
    }
  });

  it("holds each beat fully shown through the middle of its span", () => {
    for (let i = 0; i < BEATS; i++) {
      const [a, b] = beatSpan(i);
      const mid = beatState((a + b) / 2, i);
      expect(mid.shown).toBe(1);
      expect(mid.reveal).toBe(1);
    }
    // The hero is on from the very top, before any scroll.
    expect(beatState(0, 0).shown).toBe(1);
    expect(beatState(0, 0).reveal).toBe(1);
  });

  it("reveals a beat as it scrolls in: the reveal runs 0 to 1 at the start of the span", () => {
    const [a] = beatSpan(2);
    expect(beatState(a, 2).reveal).toBe(0);
    let prev = 0;
    for (let vh = a; vh < a + PLAN.beat / 2; vh += 0.05) {
      const r = beatState(vh, 2).reveal;
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(prev).toBe(1);
  });

  it("turns the logo a whole number of turns over the beats, so it faces the camera for the morph", () => {
    const end = logoPose(beatSpan(BEATS - 1)[1]);
    expect(Math.abs(Math.sin(end.turn))).toBeLessThan(1e-9);
    expect(Math.cos(end.turn)).toBeCloseTo(1, 9);
    expect(end.tilt).toBeCloseTo(0, 9);
    expect(logoPose(beatSpan(BEATS - 1)[1]).morph).toBe(0);
    expect(logoPose(INTRO_VH).morph).toBe(1);
    // The turn only ever goes forward with the scroll.
    let prev = -Infinity;
    for (let vh = 0; vh <= INTRO_VH; vh += 0.05) {
      expect(logoPose(vh).turn).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = logoPose(vh).turn;
    }
  });

  it("moves the camera smoothly, always looking at the logo", () => {
    let prev = cameraAt(0);
    for (let vh = 0.02; vh <= INTRO_VH; vh += 0.02) {
      const p = cameraAt(vh);
      expect(Math.hypot(...p.position.map((v, i) => v - prev.position[i]))).toBeLessThan(0.3);
      prev = p;
    }
    expect(cameraAt(INTRO_VH)).toEqual(cameraAt(INTRO_VH + 1));
  });
});
