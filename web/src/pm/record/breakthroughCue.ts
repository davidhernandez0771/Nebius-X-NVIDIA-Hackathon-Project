// The hand art's "break-through" cue: reach crossing the workspace plane in depth. The plane is
// the middle of reach, control depth 0.5: the auto-centered natural distance, the cube's row.
// A crossing counts once the depth is past the plane by more than the band, on the other side
// from the last side it was on; so it doesn't flicker around 0.5, and reaching the min or max of
// reach, or the 2D edges of the control square, is never an event (only depth is looked at).
// Display only: nothing here feeds the control or the gripper.

export const BREAKTHROUGH_PLANE = 0.5;
export const BREAKTHROUGH_BAND = 0.04; // half-width of the hysteresis band around the plane

export interface BreakthroughState {
  count: number; // +1 on each crossing (HandArt's `breakthrough` prop)
  dir: 1 | -1; // the last crossing: 1 moving closer (depth up), -1 moving away
}

export class BreakthroughCue {
  private side: 1 | -1 | null = null; // 1: nearer than the plane, -1: farther; null: not seen yet
  private state: BreakthroughState = { count: 0, dir: 1 };

  /** depth: this frame's control depth (0 far .. 1 near), or null when there is none. */
  update(depth: number | null): BreakthroughState {
    if (depth === null || !Number.isFinite(depth)) return this.state;
    const side = depth > BREAKTHROUGH_PLANE + BREAKTHROUGH_BAND ? 1 : depth < BREAKTHROUGH_PLANE - BREAKTHROUGH_BAND ? -1 : null;
    if (side === null) return this.state; // inside the band: keep the last side
    if (this.side !== null && side !== this.side) this.state = { count: this.state.count + 1, dir: side };
    this.side = side;
    return this.state;
  }
}
