// Which two styles the overlay shows and how far it has morphed between them.
// Pure: the renderer calls stepCycle once per animation frame.

export const HAND_ART_STYLES = ["ascii", "bayer", "halftone", "particles", "lines"] as const;
export type HandArtStyle = (typeof HAND_ART_STYLES)[number];

/** The shader's style ids, in HAND_ART_STYLES order. */
export const styleId = (s: HandArtStyle): number => HAND_ART_STYLES.indexOf(s);

export interface CycleOptions {
  /** How long a style stays before auto-morphing to the next. */
  holdMs: number;
  /** How long a morph takes. */
  morphMs: number;
  /** A style picked by the user; null cycles automatically. */
  pinned: HandArtStyle | null;
  /** Reduced motion: no morphs, one static style (the pinned one, else staticStyle). */
  reducedMotion: boolean;
  staticStyle: HandArtStyle;
}

export interface CycleState {
  a: HandArtStyle;
  b: HandArtStyle;
  /** 0 shows a, 1 shows b. */
  mix: number;
  morphing: boolean;
  /** Time spent on the current style. */
  heldMs: number;
  /** The gripper state last frame; null before the first frame. */
  lastGrip: boolean | null;
  /** Changes for every morph, so each one sweeps a different noise mask. */
  seed: number;
}

export const DEFAULT_CYCLE: CycleOptions = {
  holdMs: 4000,
  morphMs: 900,
  pinned: null,
  reducedMotion: false,
  staticStyle: "lines",
};

export function initialCycle(o: CycleOptions): CycleState {
  const s = o.pinned ?? (o.reducedMotion ? o.staticStyle : HAND_ART_STYLES[0]);
  return { a: s, b: s, mix: 0, morphing: false, heldMs: 0, lastGrip: null, seed: 0 };
}

const nextStyle = (s: HandArtStyle): HandArtStyle =>
  HAND_ART_STYLES[(styleId(s) + 1) % HAND_ART_STYLES.length];

const morphTo = (s: CycleState, b: HandArtStyle): CycleState => ({ ...s, b, mix: 0, morphing: true, seed: s.seed + 1 });

export function stepCycle(s: CycleState, dtMs: number, gripperClosed: boolean, o: CycleOptions): CycleState {
  const gripChanged = s.lastGrip !== null && s.lastGrip !== gripperClosed;
  s = { ...s, lastGrip: gripperClosed };

  if (o.reducedMotion) {
    const only = o.pinned ?? o.staticStyle;
    return { ...s, a: only, b: only, mix: 0, morphing: false, heldMs: 0 };
  }

  if (s.morphing) {
    const mix = s.mix + dtMs / o.morphMs;
    if (mix < 1) return { ...s, mix };
    return { ...s, a: s.b, mix: 0, morphing: false, heldMs: 0 };
  }

  if (o.pinned) return s.a === o.pinned ? s : morphTo(s, o.pinned);

  const heldMs = s.heldMs + dtMs;
  if (gripChanged || heldMs >= o.holdMs) return morphTo({ ...s, heldMs }, nextStyle(s.a));
  return { ...s, heldMs };
}
