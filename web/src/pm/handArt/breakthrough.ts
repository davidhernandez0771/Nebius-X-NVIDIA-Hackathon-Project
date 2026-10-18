// The break-through: a short effect when the hand passes through the workspace plane in depth
// (the page detects the crossing and bumps a counter). Pure; the renderer steps it once per
// animation frame. A crossing within the cooldown of the last accepted one is dropped; one
// after it restarts the effect, in its own direction.

export type BreakDir = 1 | -1 | 0; // 1 pushing through toward the camera, -1 backing out, 0 unknown

export const BREAK_MS = 420;
export const BREAK_COOLDOWN_MS = 250;
/** Reduced motion: a brief flash only, this long. */
export const FLASH_MS = 220;

export interface BreakState {
  /** The crossing count last frame; null before the first frame that had one. */
  lastCount: number | null;
  /** ms since the effect began; Infinity before the first. */
  ageMs: number;
  dir: BreakDir;
  /** ms since the last accepted crossing. */
  sinceStartMs: number;
  /** Changes per effect, so each tears along a different noise. */
  seed: number;
}

export const initialBreak = (): BreakState => ({ lastCount: null, ageMs: Infinity, dir: 0, sinceStartMs: Infinity, seed: 0 });

export function stepBreak(s: BreakState, dtMs: number, count: number | undefined, dir: number | undefined): BreakState {
  s = { ...s, ageMs: s.ageMs + dtMs, sinceStartMs: s.sinceStartMs + dtMs };
  if (count === undefined) return s;
  const crossed = s.lastCount !== null && count !== s.lastCount;
  s = { ...s, lastCount: count };
  if (!crossed || s.sinceStartMs < BREAK_COOLDOWN_MS) return s;
  return { ...s, ageMs: 0, sinceStartMs: 0, dir: dir === 1 || dir === -1 ? dir : 0, seed: s.seed + 1 };
}

/** 0..1 through the effect, or null when none is playing. */
export function breakProgress(s: BreakState, reducedMotion: boolean): number | null {
  const span = reducedMotion ? FLASH_MS : BREAK_MS;
  return s.ageMs < span ? s.ageMs / span : null;
}
