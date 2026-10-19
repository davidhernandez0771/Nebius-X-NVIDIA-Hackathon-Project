// The hand lock (live test #9): once a hand is picked, every other hand is ignored.
//
// Live test #9 showed a slight flicker at times: the page picked "the Right label, else the first
// hand" afresh on every frame, so a second hand in view, or MediaPipe swapping labels or array
// order, could hand control to the other hand for a frame. HandLock replaces that pick.
//
// Pure and frame-driven, like resetGesture.ts: one update() per HandFrame, and it returns the one
// hand the rest of the page may use this frame, plus a status for the chip. Rules:
// - SEARCHING: no lock. A hand (with a handedness label) whose palm stays within steadyRadius of
//   where it was first seen, in every frame for steadyMs (0.3 s), is LOCKED: its label and palm
//   position are remembered. Both getting there in the same frame: MediaPipe's "Right" label first,
//   the order the old pick used.
// - LOCKED: each frame, only a detection with the locked label, the nearest to the last palm
//   position, counts, and only within the allowed jump: glitchJump per frame (scaled up for frames
//   that were skipped, never above reacquireRadius). Every other hand is ignored, however close to
//   the camera or wherever it is in the array.
// - HOLDING: no such detection this frame. "glitch": one with the label exists but jumped farther
//   than allowed; "missing": none. The last accepted hand is returned unchanged (the same pose,
//   the same landmarks), for up to holdMs (0.7 s) after the last accepted frame. A hand that comes
//   back within the allowed jump of the last position is locked again at once.
// - LOST: held longer than holdMs. No hand is returned. The label is kept: only a hand with it,
//   held still for steadyMs again (anywhere), locks. Another hand never does; reset() (re-pick)
//   is the way to change hands.
// Distances are aspect-correct, in frame-HEIGHT units (x is scaled by width / height), measured on
// the palm center (controlRegion.palmCenter) of the raw, unmirrored frame.

import type { HandFrame, Handedness, TrackedHand } from "../../hand/contracts";
import { palmCenter } from "./controlRegion";

export interface HandLockOptions {
  steadyMs: number; // a hand must be held still this long to lock
  steadyRadius: number; // ...staying within this of where it was first seen
  holdMs: number; // the locked hand's last pose is held this long after it was last seen
  glitchJump: number; // max palm move in one frame (frameMs); more is a glitch
  frameMs: number; // the frame time glitchJump is for (~30 fps)
  reacquireRadius: number; // max distance from the last position, however long the gap
}

export const HAND_LOCK_DEFAULTS: HandLockOptions = {
  steadyMs: 300,
  steadyRadius: 0.05,
  holdMs: 700,
  glitchJump: 0.12, // ~a frame height in 0.3 s: faster than a hand moves on purpose
  frameMs: 1000 / 30,
  reacquireRadius: 0.25,
};

export type HandLockPhase = "searching" | "locked" | "holding" | "lost";

export interface HandLockStatus {
  phase: HandLockPhase;
  /** MediaPipe's label of the locked (or, when lost, remembered) hand; null while searching. */
  handedness: Handedness | null;
  /** 0..1: the steady hold toward a lock while searching or lost; 1 when locked or holding. */
  progress: number;
  /** Why this frame's hand is a held one; null otherwise. */
  held: "missing" | "glitch" | null;
}

export interface HandLockResult {
  /** The only hand the page may use this frame: the locked one, a held copy, or null. */
  hand: TrackedHand | null;
  status: HandLockStatus;
}

type Point = { x: number; y: number };
type Candidate = { label: Handedness; anchor: Point; since: number; at: Point };

export class HandLock {
  private readonly o: HandLockOptions;
  private label: Handedness | null = null;
  private lastHand: TrackedHand | null = null; // the last accepted detection
  private lastPos: Point | null = null;
  private lastT = 0;
  private candidates: Candidate[] = [];
  status: HandLockStatus = { phase: "searching", handedness: null, progress: 0, held: null };

  constructor(options: Partial<HandLockOptions> = {}) {
    this.o = { ...HAND_LOCK_DEFAULTS, ...options };
  }

  /** Re-pick: drop the lock and the remembered hand; the next hand held still locks. */
  reset(): void {
    this.label = null;
    this.lastHand = null;
    this.lastPos = null;
    this.candidates = [];
    this.status = { phase: "searching", handedness: null, progress: 0, held: null };
  }

  update(frame: HandFrame): HandLockResult {
    const t = frame.timestamp;
    const aspect = frame.frameHeight > 0 ? frame.frameWidth / frame.frameHeight : 1;
    const dist = (a: Point, b: Point) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
    const seen = frame.hands
      .filter((h): h is TrackedHand & { handedness: Handedness } => h.handedness !== null)
      .map((hand) => ({ hand, at: palmCenter(hand.landmarks) }));

    if (this.lastHand && this.lastPos && (this.status.phase === "locked" || this.status.phase === "holding")) {
      const lastPos = this.lastPos;
      const same = seen.filter((s) => s.hand.handedness === this.label);
      let best: (typeof same)[number] | null = null;
      for (const s of same) if (!best || dist(s.at, lastPos) < dist(best.at, lastPos)) best = s;
      const frames = Math.max(1, (t - this.lastT) / this.o.frameMs);
      const allowed = Math.min(this.o.reacquireRadius, this.o.glitchJump * frames);
      if (best && dist(best.at, lastPos) <= allowed) return this.accept(best.hand, best.at, t);
      if (t - this.lastT <= this.o.holdMs) {
        this.status = { phase: "holding", handedness: this.label, progress: 1, held: best ? "glitch" : "missing" };
        return { hand: this.lastHand, status: this.status };
      }
      this.lastHand = null;
      this.lastPos = null;
      this.candidates = [];
    }

    // Searching (any labeled hand) or lost (only the remembered label): the steady hold.
    const eligible = this.label === null ? seen : seen.filter((s) => s.hand.handedness === this.label);
    const next: Candidate[] = [];
    const used = new Set<Candidate>(); // each candidate continues at most one hand
    let winner: { hand: TrackedHand; at: Point; label: Handedness } | null = null;
    let progress = 0;
    for (const s of eligible) {
      // Continue the nearest candidate with this label that this hand is still within reach of.
      const prev = this.candidates
        .filter((c) => c.label === s.hand.handedness && !used.has(c))
        .sort((a, b) => dist(a.at, s.at) - dist(b.at, s.at))[0];
      const steady = prev && dist(prev.anchor, s.at) <= this.o.steadyRadius;
      if (steady) used.add(prev);
      const c: Candidate = steady ? { ...prev, at: s.at } : { label: s.hand.handedness, anchor: s.at, since: t, at: s.at };
      next.push(c);
      const p = Math.min(1, (t - c.since) / this.o.steadyMs);
      progress = Math.max(progress, p);
      if (p >= 1 && (!winner || (s.hand.handedness === "Right" && winner.label !== "Right")))
        winner = { hand: s.hand, at: s.at, label: s.hand.handedness };
    }
    this.candidates = next;
    if (winner) {
      this.label = winner.label;
      this.candidates = [];
      return this.accept(winner.hand, winner.at, t);
    }
    this.status = { phase: this.label === null ? "searching" : "lost", handedness: this.label, progress, held: null };
    return { hand: null, status: this.status };
  }

  private accept(hand: TrackedHand, at: Point, t: number): HandLockResult {
    this.lastHand = hand;
    this.lastPos = at;
    this.lastT = t;
    this.status = { phase: "locked", handedness: this.label, progress: 1, held: null };
    return { hand, status: this.status };
  }
}

/** The user's hand for MediaPipe's label: the label is mirrored on the raw camera frame (live
 *  test #4), so "Left" is the user's right hand. */
export function userHand(label: Handedness): "left" | "right" {
  return label === "Left" ? "right" : "left";
}

/** The lock chip's one line. */
export function lockChipText(s: HandLockStatus): string {
  const hand = s.handedness ? `${userHand(s.handedness)} hand` : "hand";
  if (s.phase === "locked") return `locked: ${hand}`;
  if (s.phase === "holding") return `holding: ${hand}`;
  if (s.phase === "lost") return `lost: show your ${hand}`;
  return "hold one hand still";
}
