// The spiral getting out of the arm's way: when a cartridge is taken (a drag, a click, the scroll into
// the machine), the whole spiral (its cartridges, the band they stand on) rises straight up through
// the ceiling's opening and out of view, so only the arm and the one cartridge are left; when the arm
// is done, it comes back down into place. One level, 0 down to 1 up, eased where it is applied.
// Written by the arm each frame (Arm.tsx), read by the spiral (Helix.tsx, Ribbon.tsx). Pure, tested.

/** Metres the spiral rises: its lowest cartridge's bottom (0.2 m) clears the ceiling (14.4 m) with room. */
export const LIFT_H = 18;
/** Seconds it takes to go up or come down. */
export const LIFT_S = 0.85;

export const spiralLift = { level: 0 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};

/** How far up the spiral is (metres) at a level. */
export const liftOffset = (level = spiralLift.level) => LIFT_H * smooth(level);

/** One step toward `want` (0 or 1) at the lift's pace; `reduced`: there at once. */
export function stepLift(level: number, want: number, dt: number, reduced = false): number {
  if (reduced) return want;
  const d = want - level;
  const s = dt / LIFT_S;
  return Math.abs(d) <= s ? want : level + Math.sign(d) * s;
}

/**
 * The plug-in's lift at u (plugSequence.ts PHASE): up while the cartridge is out of its slot and
 * flying (`up`), back down once it is seated and the arm has let go (`down`). A dropped one (held)
 * comes with the spiral already up.
 */
export function liftOfPlug(u: number, up: readonly [number, number], down: readonly [number, number], held: boolean): number {
  const rise = held ? 1 : clamp01((u - up[0]) / (up[1] - up[0]));
  const fall = clamp01((u - down[0]) / (down[1] - down[0]));
  return Math.min(rise, 1 - fall);
}
