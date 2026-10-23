// The spiral getting out of the arm's way: when a cartridge is taken (a drag, a click, the scroll into
// the machine), the whole spiral (its cartridges, the band they stand on) rises straight up through
// the ceiling's opening and out of view, so only the arm and the one cartridge are left; when the arm
// is done, it comes back down into place. One level, 0 down to 1 up, eased where it is applied.
// Written by the arm each frame (Arm.tsx), read by the spiral (Helix.tsx, Ribbon.tsx). It only moves
// while the arm and its cartridge are wholly inside the spiral's hollow core (clearOfSpiral), so
// nothing of the spiral ever passes through them. Pure, tested.
import * as THREE from "three";

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

/**
 * The spiral's hollow core: nothing of it comes closer to its axis than its band's inner edge (the
 * innermost slot, 2.30 m out, less the band's 0.62 m half width), less a hair.
 */
export const CORE_CLEAR = 1.66;
/** How thick each of the arm's segments is, round its line (joint drums, links, the palm): shoulder–elbow, elbow–wrist, wrist–fingertips. */
const LINK_R = [0.45, 0.36, 0.5] as const;
const _a = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * Whether the arm (its joints at `points`: shoulder, elbow, wrist, fingertips) and the cartridge it
 * holds (2.3 × 2.5 × 0.34 m, if any) are wholly inside the spiral's core, so the spiral can move past
 * them without touching: the only time it rises or comes down (Arm.tsx).
 */
export function clearOfSpiral(points: readonly THREE.Vector3[], held?: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null): boolean {
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i <= 10; i++) {
      _a.lerpVectors(points[s], points[s + 1], i / 10);
      if (Math.hypot(_a.x, _a.z) + LINK_R[s] >= CORE_CLEAR) return false;
    }
  }
  if (held) {
    for (const x of [-1.15, 1.15])
      for (const z of [-0.17, 0.17]) {
        _c.set(x, 0, z).applyQuaternion(held.quaternion).add(held.position);
        if (Math.hypot(_c.x, _c.z) >= CORE_CLEAR) return false;
      }
  }
  return true;
}
