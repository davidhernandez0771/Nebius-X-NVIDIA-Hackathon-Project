// What the arm is doing for the cartridge in the hand, shared between the drag (which choreographs
// it: stations/workshop/Dragged.tsx), the arm (which puts its fingertips where it is told: Arm.tsx)
// and the spiral (which parts where the arm passes through it: Helix.tsx). Mutated in place, like
// plug.ts; the gap's arithmetic is pure, so it is tested.
import * as THREE from "three";

export const armTask = {
  /** The drag is steering the arm: its fingertips go to `grip`, exactly. Else it looks about on its own. */
  active: false,
  /** Where the fingertips are to be (world), and the hand's turn about the vertical (world yaw). */
  grip: new THREE.Vector3(),
  handYaw: 0,
  /** 0 open, 1 closed on a cartridge's top edge. */
  closed: 0,
  /** The hand's light: 0 resting, 1 over a drop target. */
  glow: 0,
  /** Written by the arm every frame: where its fingertips are now, so a task starts from there. */
  hand: new THREE.Vector3(0, 6, 1.5),
  handYawNow: 0,
};

/**
 * Where the spiral opens: round the bearing `yaw` (about the axis), over the heights `y0`–`y1`, by
 * `level` (0 shut, 1 open). The arm writes the band its links cross the spiral in; a pick also opens
 * it round the slot it is taking from.
 */
export const gap = { level: 0, yaw: 0, y0: 0, y1: 0 };

/** Radians a cartridge right in the arm's way moves aside, and how far round the opening reaches. */
export const GAP_PUSH = 0.38;
export const GAP_REACH = 1.1;
/** Metres a cartridge moving all the way aside also sinks in toward the axis (the spiral draws back as it parts). */
export const GAP_INSET = 0.3;
/** Metres above and below the band a cartridge still moves aside for (half a cartridge's height, and a little). */
export const GAP_MARGIN = 1.4;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * How far round the axis (radians, signed: away from the opening) a cartridge standing at bearing
 * `az` and height `y` moves aside. Nearest the opening it moves most; it fades out round the side and
 * above and below the band.
 */
export function gapShift(az: number, y: number, g = gap): number {
  if (g.level <= 0) return 0;
  const d = wrap(az - g.yaw);
  const ad = Math.abs(d);
  if (ad >= GAP_REACH) return 0;
  const below = g.y0 - GAP_MARGIN - y;
  const above = y - (g.y1 + GAP_MARGIN);
  const outside = Math.max(below, above, 0);
  const vertical = Math.max(0, 1 - outside / 1.2);
  if (vertical <= 0) return 0;
  // Smooth in both directions; a cartridge dead ahead goes the way it already leans (or +).
  const across = 1 - ad / GAP_REACH;
  const k = across * across * (3 - 2 * across);
  const v = vertical * vertical * (3 - 2 * vertical);
  return (d >= 0 ? 1 : -1) * GAP_PUSH * k * v * g.level;
}

export function resetArmTask(): void {
  armTask.active = false;
  armTask.closed = 0;
  armTask.glow = 0;
  gap.level = 0;
}
