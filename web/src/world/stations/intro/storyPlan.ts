// The intro's plan, in viewport heights of scroll (vh): a story you descend through, like Active
// Theory's forest → spine → reactor → lab. The hero (the glass logo in the dark), the sink below it, the
// forest floor (the problem), the drop down the crack, the reactor powering up (S·A·N·T, the proof,
// Nemotron), then the ring stage, where the core's top ring lifts off at full power and becomes THE RING
// the descent dives through. Everything is a pure function of the scroll, so every drop plays backwards
// on the way up, and the places are lit one at a time with full dark between them (placeLights), so one
// never shows through another. The camera is path.ts; Scene.tsx, Places.tsx and Story.tsx read these.
// (Not story.ts: next to Story.tsx that name breaks Windows, see fileNames.test.ts.)
import { smoother } from "../../core/rail";

/** The stages, top to bottom, with their scroll lengths (vh). */
export const PLAN = [
  { id: "hero", vh: 1.2 },
  { id: "sink", vh: 1.5 },
  { id: "forest", vh: 1.9 },
  { id: "crack", vh: 1.5 },
  { id: "reactor", vh: 4.5 },
  { id: "ring", vh: 1.1 },
] as const;

export type Stage = (typeof PLAN)[number]["id"];

const STARTS = PLAN.map((_, i) => PLAN.slice(0, i).reduce((s, p) => s + p.vh, 0));

/** A stage's span [start, end) in vh. */
export function span(id: Stage): [number, number] {
  const i = PLAN.findIndex((p) => p.id === id);
  return [STARTS[i], STARTS[i] + PLAN[i].vh];
}

/** The intro's dwell in vh. */
export const INTRO_VH = STARTS[STARTS.length - 1] + PLAN[PLAN.length - 1].vh;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 0–1 through a stage. */
export const progress = (id: Stage, vh: number) => {
  const [a, b] = span(id);
  return clamp01((vh - a) / (b - a));
};
/** The vh at fraction k of a stage. */
const at = (id: Stage, k: number) => {
  const [a, b] = span(id);
  return a + (b - a) * k;
};

/** The hero and the four beats: the problem in the forest, then three as the reactor powers up. */
export const BEATS = 5;

/** Beat i's span [start, end) in vh. Beat 0 is the hero. */
export function beatSpan(i: number): [number, number] {
  if (i === 0) return span("hero");
  if (i === 1) return span("forest");
  const [a, b] = span("reactor");
  const len = (b - a) / 3;
  return [a + (i - 2) * len, a + (i - 1) * len];
}

export interface BeatState {
  /** 0–1 through the span. */
  k: number;
  /** Opacity: in at the start of the span, out at its end. */
  shown: number;
  /** The headline's line-mask reveal (and the column's stagger): 0–1 over the first part of the span. */
  reveal: number;
}

/** How beat i shows at scroll `vh`. Only one beat is ever on screen, and none on the way down. */
export function beatState(vh: number, i: number): BeatState {
  const [a, b] = beatSpan(i);
  const len = b - a;
  const k = clamp01((vh - a) / len);
  if (i === 0) return { k, shown: 1 - smooth(a + len * 0.55, b, vh), reveal: 1 };
  const shown = vh < a || vh >= b ? 0 : smooth(a, a + len * 0.14, vh) * (1 - smooth(b - len * 0.16, b, vh));
  return { k, shown, reveal: clamp01((vh - a) / (len * 0.36)) };
}

/** The places that are drawn; the drops between them are dark. */
export const PLACES = ["hero", "forest", "reactor"] as const;
export type Place = (typeof PLACES)[number];

/**
 * How lit each place is (0 is not drawn at all). The hero goes out as the camera sinks below it, the
 * forest comes up out of the dark as the camera reaches the trunks, goes out as it drops into the crack,
 * and the reactor's glow comes up near the fissure's bottom. Between, nothing is lit. The reactor stays
 * lit to the end: the descent's burst takes it (Places.tsx).
 */
export function placeLights(vh: number): Record<Place, number> {
  return {
    hero: 1 - smooth(at("sink", 0), at("sink", 0.4), vh),
    forest: smooth(at("sink", 0.6), at("sink", 1), vh) * (1 - smooth(at("crack", 0.3), at("crack", 0.45), vh)),
    reactor: smooth(at("crack", 0.78), at("crack", 1), vh),
  };
}

/**
 * The fall's own light, 0–1: the crack's walls lit from below by the reactor's cold glow (Crack.tsx). Part of the
 * drop, not a place: it comes up as the forest goes out, so rock, roots and boulders stream past, and hands over
 * to the reactor as its glow comes up near the fissure's bottom.
 */
export function dropLight(vh: number): number {
  return smooth(at("crack", 0.3), at("crack", 0.45), vh) * (1 - smooth(at("crack", 0.8), at("crack", 0.98), vh));
}

/** The reactor's power, 0–1: dormant as the camera arrives, climbing through its three beats, full for the ring. */
export function power(vh: number): number {
  return progress("reactor", vh) ** 1.1;
}

/** 0–1: the top ring lifting off the core into THE RING, once the power is full. */
export function ringLift(vh: number): number {
  const [a, b] = span("ring");
  return smoother((vh - a) / ((b - a) * 0.75));
}

export interface LogoPose {
  /** Turn about its vertical axis (radians), only ever forward with the scroll. */
  turn: number;
  /** Lean about its horizontal axis (radians). */
  tilt: number;
}

/** The hero logo: one whole turn and a lean that settles while the camera sinks away from it. */
export function logoPose(vh: number): LogoPose {
  const k = smoother(vh / span("sink")[1]);
  return { turn: Math.PI * 2 * k, tilt: 0.16 * (1 - k) };
}
