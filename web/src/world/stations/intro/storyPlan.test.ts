import { describe, expect, it } from "vitest";
import { BEATS, beatSpan, beatState, INTRO_VH, logoPose, placeLights, PLACES, PLAN, power, ringLift, span, type Place } from "./storyPlan";

const STEP = 0.01;
const each = (fn: (vh: number) => void) => {
  for (let vh = 0; vh <= INTRO_VH + 0.5; vh += STEP) fn(vh);
};
const mid = (s: readonly [number, number]) => (s[0] + s[1]) / 2;

describe("the intro's plan: places stacked downward, drops between them", () => {
  it("runs hero → sink → forest → crack → reactor → ring, end to end", () => {
    expect(PLAN.map((p) => p.id)).toEqual(["hero", "sink", "forest", "crack", "reactor", "ring"]);
    expect(span("hero")[0]).toBe(0);
    for (let i = 1; i < PLAN.length; i++) expect(span(PLAN[i].id)[0]).toBeCloseTo(span(PLAN[i - 1].id)[1], 9);
    expect(span("ring")[1]).toBeCloseTo(INTRO_VH, 9);
  });

  it("puts the hero on the logo, the problem in the forest, and S·A·N·T, the proof and Nemotron in the reactor", () => {
    expect(BEATS).toBe(5);
    expect(beatSpan(0)).toEqual(span("hero"));
    expect(beatSpan(1)).toEqual(span("forest"));
    const [ra, rb] = span("reactor");
    expect(beatSpan(2)[0]).toBeCloseTo(ra, 9);
    expect(beatSpan(3)[0]).toBeCloseTo(beatSpan(2)[1], 9);
    expect(beatSpan(4)[0]).toBeCloseTo(beatSpan(3)[1], 9);
    expect(beatSpan(4)[1]).toBeCloseTo(rb, 9);
  });

  it("shows one beat at a time, and none on the way down between places", () => {
    each((vh) => {
      const live = Array.from({ length: BEATS }, (_, i) => beatState(vh, i)).filter((s) => s.shown > 0.01);
      expect(live.length).toBeLessThanOrEqual(1);
    });
    for (const drop of ["sink", "crack"] as const) {
      const [a, b] = span(drop);
      for (let vh = a + (b - a) * 0.3; vh <= b - (b - a) * 0.1; vh += STEP)
        for (let i = 0; i < BEATS; i++) expect(beatState(vh, i).shown).toBe(0);
    }
  });

  it("holds each beat fully shown through the middle of its span, the hero from the very top", () => {
    for (let i = 0; i < BEATS; i++) {
      const s = beatState(mid(beatSpan(i)), i);
      expect(s.shown).toBe(1);
      expect(s.reveal).toBe(1);
    }
    expect(beatState(0, 0).shown).toBe(1);
  });

  it("reveals a beat as it scrolls in", () => {
    const [a] = beatSpan(2);
    expect(beatState(a, 2).reveal).toBe(0);
    let prev = 0;
    for (let vh = a; vh < a + (beatSpan(2)[1] - a) / 2; vh += 0.05) {
      const r = beatState(vh, 2).reveal;
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(prev).toBe(1);
  });
});

describe("the places' light: one place at a time, darkness between", () => {
  it("never lights two places at once", () => {
    each((vh) => {
      const l = placeLights(vh);
      const lit = PLACES.filter((p) => l[p] > 0);
      expect(lit.length).toBeLessThanOrEqual(1);
      for (const p of PLACES) {
        expect(l[p]).toBeGreaterThanOrEqual(0);
        expect(l[p]).toBeLessThanOrEqual(1);
      }
    });
  });

  it("passes through full dark in the middle of each drop", () => {
    for (const drop of ["sink", "crack"] as const) {
      const [a, b] = span(drop);
      const dark = (vh: number) => PLACES.every((p) => placeLights(vh)[p] === 0);
      // A stretch of real darkness, not one instant.
      let run = 0;
      for (let vh = a; vh <= b; vh += STEP) run = dark(vh) ? run + STEP : run;
      expect(run).toBeGreaterThan((b - a) * 0.15);
    }
  });

  it("lights each place fully while the camera is in it", () => {
    const at: Record<Place, number> = { hero: mid(span("hero")), forest: mid(span("forest")), reactor: mid(span("reactor")) };
    for (const p of PLACES) expect(placeLights(at[p])[p]).toBe(1);
    expect(placeLights(0).hero).toBe(1);
    // The reactor stays lit to the end: the descent's burst takes it.
    expect(placeLights(INTRO_VH).reactor).toBe(1);
  });

  it("plays backwards: the same scroll gives the same light, whichever way it came", () => {
    // No state: scrolling down then back up reads the same values at the same places.
    const n = Math.ceil(INTRO_VH / STEP);
    const down = Array.from({ length: n }, (_, k) => placeLights(k * STEP));
    const up: typeof down = [];
    for (let k = n - 1; k >= 0; k--) up.unshift(placeLights(k * STEP));
    expect(up).toEqual(down);
  });
});

describe("the reactor's power", () => {
  it("is off until the reactor, climbs only forward with the scroll, and is full when the ring stage starts", () => {
    expect(power(0)).toBe(0);
    expect(power(span("reactor")[0])).toBe(0);
    let prev = 0;
    each((vh) => {
      const p = power(vh);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = p;
    });
    expect(power(span("ring")[0])).toBe(1);
    expect(power(INTRO_VH)).toBe(1);
  });

  it("is visibly climbing through the three reactor beats", () => {
    const p = [2, 3, 4].map((i) => power(mid(beatSpan(i))));
    expect(p[0]).toBeGreaterThan(0.1);
    expect(p[1]).toBeGreaterThan(p[0] + 0.15);
    expect(p[2]).toBeGreaterThan(p[1] + 0.15);
    expect(p[2]).toBeLessThan(1);
  });

  it("lifts the top ring into THE RING only at full power, done before the intro ends", () => {
    each((vh) => {
      if (ringLift(vh) > 0) expect(power(vh)).toBe(1);
    });
    expect(ringLift(span("ring")[0])).toBe(0);
    expect(ringLift(INTRO_VH)).toBe(1);
    expect(ringLift(span("ring")[1] - 0.15)).toBe(1);
  });
});

describe("the hero logo", () => {
  it("turns only forward with the scroll and stops once the camera has left it", () => {
    let prev = -Infinity;
    each((vh) => {
      expect(logoPose(vh).turn).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = logoPose(vh).turn;
    });
    expect(logoPose(span("sink")[1]).turn).toBe(logoPose(INTRO_VH).turn);
    expect(logoPose(span("sink")[1]).tilt).toBe(logoPose(INTRO_VH).tilt);
  });
});
