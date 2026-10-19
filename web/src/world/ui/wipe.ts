// The intro's "breaks", after activetheory.net: a dark slab with a slanted, slightly torn top edge
// moves up with the scroll and uncovers a section (a headline left, a few lines right); the next
// slab's edge uncovers the next section, and after the last one an edge sweeps off and gives the 3D
// back. Pure math, in viewport heights (vh) of scroll from the start of the breaks.
//
// Each section is one "band": a slab 100 + 2·SLANT vh tall whose top edge is the edge that reveals
// it and whose bottom edge is the edge that reveals the next. Only one edge is ever on screen, so
// moving a band is a translateY (compositor only) and its clip-path is set once. Its content is
// translated back by the same amount, so the text stays put while the edge sweeps over it.

export interface BreakPlan {
  /** Scroll (vh) before the first edge starts: the hero (the logo, "Scroll down"). */
  hero: number;
  /** Scroll (vh) an edge takes to cross the screen, bottom to top. */
  wipe: number;
  /** Scroll (vh) a section holds still, fully shown, before the next edge starts. */
  dwell: number;
  /** How many sections. There are sections + 1 edges: the last one hands back the 3D. */
  sections: number;
}

export const PLAN: BreakPlan = { hero: 1, wipe: 1, dwell: 0.5, sections: 4 };

/** The edge's drop from its right end to its left end, in vh (the right side leads). */
export const SLANT = 30;
/** Room (vh) past the screen's edge for the tear, so an edge starts and ends fully off screen. */
export const MARGIN = 2;
/** How far (vh) an edge's middle travels: from just under the screen to just over it. */
export const SPAN = 100 + SLANT + 2 * MARGIN;
/** The band's height in vh: an edge's travel plus a slant (the bottom edge is one SPAN below the top). */
export const BAND_VH = SPAN + SLANT;
/** Points along each edge (the torn look); the ends included. */
export const EDGE_POINTS = 33;

const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
/** A number for CSS or SVG: three decimals at most. */
const fix = (v: number) => String(Math.round(v * 1000) / 1000);

/** Scroll (vh) where edge k starts to move. Edge k reveals section k (and ends section k − 1). */
export function edgeStart(k: number, plan: BreakPlan = PLAN): number {
  return plan.hero + k * (plan.wipe + plan.dwell);
}

/** Scroll (vh) where section k is first fully shown (the start of its dwell). */
export function sectionShown(k: number, plan: BreakPlan = PLAN): number {
  return edgeStart(k, plan) + plan.wipe;
}

/** The whole run in vh: the hero, every section's wipe and dwell, and the edge that ends the last. */
export function breaksLength(plan: BreakPlan = PLAN): number {
  return edgeStart(plan.sections, plan) + plan.wipe;
}

/**
 * 0–1: how far edge k has crossed at scroll s (vh). With reduced motion there is no sweep: the edge
 * is either not there yet or gone, switching halfway, so the sections swap at once.
 */
export function edgeProgress(s: number, k: number, reduced = false, plan: BreakPlan = PLAN): number {
  const p = clamp01((s - edgeStart(k, plan)) / plan.wipe);
  return reduced ? (p >= 0.5 ? 1 : 0) : p;
}

export interface BandState {
  /** Where the band's box starts, in vh from the top of the viewport (the band's translateY). */
  y: number;
  /** Any of it on screen. */
  visible: boolean;
  /** The section is showing well enough to read: its headline scrambles in on the way to true. */
  on: boolean;
  /** Its top edge is done and its bottom edge hasn't started: it fills the screen. */
  full: boolean;
}

/** Band k at scroll s (vh). */
export function band(s: number, k: number, reduced = false, plan: BreakPlan = PLAN): BandState {
  const a = edgeProgress(s, k, reduced, plan);
  const b = edgeProgress(s, k + 1, reduced, plan);
  // Its top edge's middle runs from just below the screen (100 + SLANT/2 + MARGIN) up past the top,
  // then its bottom edge's does the same; the band's box starts SLANT/2 above the top edge's middle.
  const y = 100 + MARGIN - (a + b) * SPAN;
  return { y, visible: a > 0 && b < 1, on: a > 0.3 && b < 0.7, full: a >= 1 && b <= 0 };
}

/** A small seeded random (mulberry32), so an edge tears the same way every time. */
function seeded(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Edge k's tear: a small offset (vh) at each of the EDGE_POINTS, the same for the band above it and
 * the band below it, so the two meet with no gap. Mostly under half a vh, now and then a deeper nick.
 */
export function tear(k: number): number[] {
  const rnd = seeded(0x5a17 + k * 977);
  return Array.from({ length: EDGE_POINTS }, () => {
    const fine = (rnd() - 0.5) * 0.9;
    const nick = rnd() < 0.14 ? (rnd() - 0.5) * 2.2 : 0;
    return Math.round((fine + nick) * 100) / 100;
  });
}

/** An edge in a band's own box: its points as [x %, y vh], left to right, with its middle at `mid` vh. */
export function edgePoints(mid: number, k: number): [number, number][] {
  const off = tear(k);
  return off.map((o, i) => {
    const u = i / (EDGE_POINTS - 1);
    return [u * 100, mid + SLANT * (0.5 - u) + o];
  });
}

/** Where a band's top and bottom edges sit in its own box (vh). */
export const TOP_MID = SLANT / 2;
export const BOTTOM_MID = TOP_MID + SPAN;

/** Band k's clip-path: its top edge (edge k) left to right, then its bottom edge (edge k + 1) back. */
export function bandClip(k: number): string {
  const top = edgePoints(TOP_MID, k);
  const bottom = edgePoints(BOTTOM_MID, k + 1).reverse();
  return `polygon(${[...top, ...bottom].map(([x, y]) => `${fix(x)}% ${fix(y)}vh`).join(", ")})`;
}

/** The height (vh) of the SVG that draws an edge's line: the slant plus the tear's room above and below. */
export const LINE_VH = SLANT + 2 * MARGIN;

/**
 * An edge as SVG polyline points, in a viewBox of 100 × LINE_VH whose top is MARGIN vh above the
 * edge's highest point; `inset` (vh) nudges it down into the band below it (negative: up into the one above).
 */
export function edgeLine(k: number, inset: number): string {
  return edgePoints(SLANT / 2 + MARGIN + inset, k)
    .map(([x, y]) => `${fix(x)},${fix(y)}`)
    .join(" ");
}
