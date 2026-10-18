// Which two styles the overlay shows, how far it has crossfaded between them, and how long
// each has been running (styles like the bloom and the burst play out from their start).
// Pure: the renderer calls stepCycle once per animation frame with the target style (from
// artDirector, or the one a user picked).
//
// A new target starts a crossfade at most once per cooldown. Unlike a one-off event, a target
// is a state: one that arrives during the cooldown or a running crossfade is followed as soon
// as both are over, never dropped.

export const HAND_ART_STYLES = ["ink", "bloom", "burst", "trail", "ripple", "glitch"] as const;
export type HandArtStyle = (typeof HAND_ART_STYLES)[number];

/** The shader's style ids, in HAND_ART_STYLES order. */
export const styleId = (s: HandArtStyle): number => HAND_ART_STYLES.indexOf(s);

/** Reduced motion shows each style frozen at this age: grown, mid-flight, settled. */
export const STATIC_AGE_MS = 650;

export interface CycleOptions {
  /** How long a crossfade takes. */
  morphMs: number;
  /** A target this soon after the last crossfade began waits. */
  cooldownMs: number;
  /** A style picked by the user, held whatever the target. */
  pinned: HandArtStyle | null;
  /** Reduced motion: no crossfades, one static style (the pinned one, else staticStyle). */
  reducedMotion: boolean;
  staticStyle: HandArtStyle;
}

export interface CycleState {
  a: HandArtStyle;
  b: HandArtStyle;
  /** 0 shows a, 1 shows b. */
  mix: number;
  morphing: boolean;
  /** ms since a began, and since b began. */
  ageA: number;
  ageB: number;
  /** ms since the last crossfade began. */
  sinceMorphMs: number;
  /** Changes for every crossfade, so each one sweeps a different noise mask. */
  seed: number;
}

export const DEFAULT_CYCLE: CycleOptions = {
  morphMs: 400,
  cooldownMs: 400,
  pinned: null,
  reducedMotion: false,
  staticStyle: "ink",
};

export function initialCycle(o: CycleOptions, target: HandArtStyle): CycleState {
  const s = o.reducedMotion ? (o.pinned ?? o.staticStyle) : (o.pinned ?? target);
  const age = o.reducedMotion ? STATIC_AGE_MS : 0;
  return { a: s, b: s, mix: 0, morphing: false, ageA: age, ageB: age, sinceMorphMs: Infinity, seed: 0 };
}

export function stepCycle(s: CycleState, dtMs: number, target: HandArtStyle, o: CycleOptions): CycleState {
  if (o.reducedMotion) {
    const only = o.pinned ?? o.staticStyle;
    return { ...s, a: only, b: only, mix: 0, morphing: false, ageA: STATIC_AGE_MS, ageB: STATIC_AGE_MS };
  }
  s = { ...s, ageA: s.ageA + dtMs, ageB: s.ageB + dtMs, sinceMorphMs: s.sinceMorphMs + dtMs };

  if (s.morphing) {
    const mix = s.mix + dtMs / o.morphMs;
    if (mix < 1) return { ...s, mix };
    return { ...s, a: s.b, ageA: s.ageB, mix: 0, morphing: false };
  }

  const want = o.pinned ?? target;
  if (want === s.a || s.sinceMorphMs < o.cooldownMs) return s;
  return { ...s, b: want, ageB: 0, mix: 0, morphing: true, sinceMorphMs: 0, seed: s.seed + 1 };
}
