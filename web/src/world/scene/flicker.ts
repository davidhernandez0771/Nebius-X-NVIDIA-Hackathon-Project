// The lamps' flicker: their power as a level 0–1 over time. The room's light is baked into its atlases, so
// "the lamps" are one level that scales every baked material and the few live lights (power.ts).
// - sputter(): while the files load, the lamps try and fail: short dim flashes, a little more often
//   as more arrives;
// - powerOn(): once everything is in, the fluorescent start: two false starts, a dip, then full.
// Pure, so the curves are tested.

/** The level with the lamps off: the room is a dark silhouette, not black. */
export const OFF = 0.035;

/** [start s, end s, level] spans of the power-on; between spans the lamps are OFF. Ends at 1. */
const START: readonly (readonly [number, number, number])[] = [
  [0.0, 0.06, 0.55],
  [0.16, 0.2, 0.3],
  [0.42, 0.56, 0.75],
  [0.62, 0.66, 0.4],
];
/** After the last false start, the level rises to full over this long. */
const RAMP: readonly [number, number] = [0.74, 1.1];
export const POWER_ON_S = RAMP[1];

const smooth = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

/** When the power-on began, for lamps switched on at `now`: a room stood whole by a jump starts already through it. */
export function lampsOnAt(now: number, snapped: boolean): number {
  return snapped ? now - POWER_ON_S : now;
}

export function powerOn(t: number): number {
  if (t < 0) return OFF;
  if (t >= RAMP[1]) return 1;
  if (t >= RAMP[0]) return OFF + (1 - OFF) * smooth((t - RAMP[0]) / (RAMP[1] - RAMP[0]));
  for (const [a, b, level] of START) if (t >= a && t < b) return level;
  return OFF;
}

/** A cheap repeatable hash in [0, 1) (no Math.random, so a frame always shows the same level). */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Flash length and the slot each flash may land in. */
const FLASH_S = 0.07;
const SLOT_S = 0.45;

/** While loading: OFF, with a brief flash in some slots; `progress` 0–1 makes them likelier and brighter. */
export function sputter(t: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  const slot = Math.floor(t / SLOT_S);
  const r = hash(slot);
  if (r > 0.25 + 0.45 * p) return OFF;
  const at = hash(slot + 0.5) * (SLOT_S - FLASH_S);
  const u = t - slot * SLOT_S - at;
  if (u < 0 || u > FLASH_S) return OFF;
  return OFF + (0.12 + 0.2 * p) * hash(slot + 0.25 + 0.75 * p);
}

/** With reduced motion: no flicker, a plain fade up once loaded. */
export const FADE_S = 0.4;
export function fadeOn(t: number): number {
  return t <= 0 ? OFF : OFF + (1 - OFF) * smooth(t / FADE_S);
}
