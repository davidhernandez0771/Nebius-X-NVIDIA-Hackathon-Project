import { describe, expect, it } from "vitest";
import {
  BEATS,
  beatSpan,
  beatState,
  dropLight,
  INTRO_VH,
  logoPose,
  placeLights,
  PLACES,
  PLAN,
  power,
  PROOF_BEAT_VH,
  PROOF_BEATS,
  PROOF_DRAWN,
  proofBeatSpan,
  proofBeatState,
  ringLift,
  span,
  type Place,
} from "./storyPlan";

const STEP = 0.01;
const each = (fn: (vh: number) => void) => {
  for (let vh = 0; vh <= INTRO_VH + 0.5; vh += STEP) fn(vh);
};
const mid = (s: readonly [number, number]) => (s[0] + s[1]) / 2;

describe("the intro's plan: places stacked downward, drops between them", () => {
  it("runs hero → sink → forest → crack → reactor → proof → ring, end to end", () => {
    expect(PLAN.map((p) => p.id)).toEqual(["hero", "sink", "forest", "crack", "reactor", "proof", "ring"]);
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

  it("lights the crack's walls during the fall (part of the drop, not a place): up as the forest goes out, gone when the reactor is in", () => {
    const [a, b] = span("crack");
    const at = (k: number) => a + (b - a) * k;
    each((vh) => {
      const d = dropLight(vh);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      if (vh < a || vh > b) expect(d).toBe(0);
      const l = placeLights(vh);
      if (l.forest === 1 || l.reactor === 1 || l.hero > 0) expect(d).toBe(0);
    });
    expect(dropLight(at(0.6))).toBe(1);
    // It comes up while the forest goes out, and hands over to the reactor's glow.
    expect(dropLight(at(0.4))).toBeGreaterThan(0);
    expect(placeLights(at(0.4)).forest).toBeGreaterThan(0);
    expect(dropLight(at(0.9))).toBeGreaterThan(0);
    expect(placeLights(at(0.9)).reactor).toBeGreaterThan(0);
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

// intro-proof (2026-10-26, the user): after the reactor's beats and before the ring, the story holds on the powered
// core for the proof: how SANT works, the climb, the teacher with and without demos, the teacher's speed gate.
describe("the proof beats", () => {
  const all = (vh: number) => [
    ...Array.from({ length: BEATS }, (_, i) => beatState(vh, i).shown),
    ...Array.from({ length: PROOF_BEATS }, (_, i) => proofBeatState(vh, i).shown),
  ];

  it("fill the proof stage, between the reactor's beats and the ring, a generous stretch each", () => {
    expect(PROOF_BEATS).toBe(4);
    expect(PROOF_BEAT_VH).toBeGreaterThanOrEqual(1.5);
    const [a, b] = span("proof");
    expect(a).toBeCloseTo(span("reactor")[1], 9);
    expect(b).toBeCloseTo(span("ring")[0], 9);
    expect(proofBeatSpan(0)[0]).toBeCloseTo(a, 9);
    for (let i = 1; i < PROOF_BEATS; i++) expect(proofBeatSpan(i)[0]).toBeCloseTo(proofBeatSpan(i - 1)[1], 9);
    expect(proofBeatSpan(PROOF_BEATS - 1)[1]).toBeCloseTo(b, 9);
    for (let i = 0; i < PROOF_BEATS; i++) expect(proofBeatSpan(i)[1] - proofBeatSpan(i)[0]).toBeCloseTo(PROOF_BEAT_VH, 9);
  });

  it("show one beat at a time, story and proof together, and none during the ring", () => {
    each((vh) => expect(all(vh).filter((v) => v > 0.01).length).toBeLessThanOrEqual(1));
    const [ra, rb] = span("ring");
    for (let vh = ra; vh <= rb; vh += STEP) for (let i = 0; i < PROOF_BEATS; i++) expect(proofBeatState(vh, i).shown).toBe(0);
  });

  it("draw their graph with the scroll: nothing at the start, only forward, whole well before the beat goes", () => {
    for (let i = 0; i < PROOF_BEATS; i++) {
      const [a, b] = proofBeatSpan(i);
      expect(proofBeatState(a, i).draw).toBe(0);
      let prev = 0;
      for (let vh = a; vh < b; vh += 0.01) {
        const d = proofBeatState(vh, i).draw;
        expect(d).toBeGreaterThanOrEqual(prev);
        prev = d;
      }
      // Drawn by PROOF_DRAWN of the span, then held whole and fully shown for at least a third of it.
      expect(PROOF_DRAWN).toBeLessThanOrEqual(0.6);
      for (let k = PROOF_DRAWN + 0.005; k <= 0.88; k += 0.01) {
        const s = proofBeatState(a + (b - a) * k, i);
        expect(s.draw).toBe(1);
        expect(s.shown).toBe(1);
      }
      // Half way through the drawing, half drawn (roughly): it is scrubbed, not timed.
      const half = proofBeatState(a + (b - a) * (0.1 + PROOF_DRAWN) / 2, i).draw;
      expect(half).toBeGreaterThan(0.3);
      expect(half).toBeLessThan(0.7);
    }
  });

  it("play backwards: the same scroll gives the same state", () => {
    const [a, b] = span("proof");
    const at = (vh: number) => Array.from({ length: PROOF_BEATS }, (_, i) => proofBeatState(vh, i));
    const n = Math.round((b - a) / STEP);
    const down: ReturnType<typeof at>[] = [];
    for (let j = 0; j <= n; j++) down.push(at(a + j * STEP));
    const up: ReturnType<typeof at>[] = [];
    for (let j = n; j >= 0; j--) up.unshift(at(a + j * STEP));
    expect(up.length).toBe(down.length);
    up.forEach((u, j) => u.forEach((s, i) => expect(s.draw).toBeCloseTo(down[j][i].draw, 6)));
  });

  it("keep the reactor at full power and lit, the top ring resting, while they show", () => {
    const [a, b] = span("proof");
    for (let vh = a; vh <= b; vh += STEP) {
      expect(power(vh)).toBe(1);
      expect(placeLights(vh).reactor).toBe(1);
      expect(ringLift(vh)).toBe(0);
    }
  });
});
