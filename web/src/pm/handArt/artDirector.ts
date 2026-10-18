// Which hand-art style the Record page's state calls for. Pure; the renderer steps it once
// per animation frame. States (no hand, gripper closed, recording) hold a style while they
// last; events (release, reset) play a style for a fixed time. Ranked, most urgent first:
// reset (glitch) > no hand (ripple) > grab (bloom) > release (burst) > recording (trail) >
// idle (ink).

import type { HandArtStyle } from "./styleCycle";

export interface ArtSignals {
  /** A hand is tracked this frame. */
  hand: boolean;
  gripperClosed: boolean;
  /** The sim is recording. Undefined: the page doesn't say (see cue). */
  recording?: boolean;
  /** reset_scene messages sent so far; each rise is a reset. Undefined: the page doesn't say. */
  resets?: number;
  /**
   * A page that sends neither recording nor resets (pm/hand-v3's Record) bumps this counter on
   * each event instead. A bump the gripper doesn't explain (Reset scene, record start/stop)
   * plays the reset glitch, so those moments still show; it can't tell which one it was.
   */
  cue?: number;
  /** Optional: a page whose hand control freezes the arm. null (unknown) keeps the last value. */
  frozen?: boolean | null;
}

export interface DirectorState {
  last: ArtSignals | null;
  frozen: boolean;
  /** How long no hand has been tracked. */
  lostMs: number;
  releaseLeftMs: number;
  resetLeftMs: number;
}

export const RELEASE_MS = 1100;
export const RESET_MS = 900;
/** No hand for this long counts as paused; a dropped frame or two does not. */
export const LOST_MS = 300;

export const initialDirector = (): DirectorState => ({
  last: null,
  frozen: false,
  lostMs: 0,
  releaseLeftMs: 0,
  resetLeftMs: 0,
});

export function stepDirector(s: DirectorState, dtMs: number, x: ArtSignals): { state: DirectorState; style: HandArtStyle } {
  const p = s.last;
  let releaseLeftMs = Math.max(0, s.releaseLeftMs - dtMs);
  let resetLeftMs = Math.max(0, s.resetLeftMs - dtMs);
  if (p) {
    if (p.gripperClosed && !x.gripperClosed) releaseLeftMs = RELEASE_MS;
    if (x.gripperClosed) releaseLeftMs = 0;
    if ((x.resets ?? 0) > (p.resets ?? 0)) resetLeftMs = RESET_MS;
    const explicit = x.recording !== undefined || x.resets !== undefined;
    const cueBump = x.cue !== undefined && p.cue !== undefined && x.cue !== p.cue;
    if (!explicit && cueBump && x.gripperClosed === p.gripperClosed) resetLeftMs = RESET_MS;
  }
  const frozen = x.frozen ?? s.frozen;
  const lostMs = x.hand ? 0 : s.lostMs + dtMs;
  const state = { last: x, frozen, lostMs, releaseLeftMs, resetLeftMs };

  const style: HandArtStyle =
    resetLeftMs > 0
      ? "glitch"
      : frozen || lostMs >= LOST_MS
        ? "ripple"
        : x.gripperClosed
          ? "bloom"
          : releaseLeftMs > 0
            ? "burst"
            : x.recording
              ? "trail"
              : "ink";
  return { state, style };
}
