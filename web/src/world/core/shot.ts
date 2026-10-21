// The camera rig's shot changes, pure so they are tested: a new shot (a new key) tweens from where the
// camera is, or cuts behind the veil with reduced motion; CameraRig runs these every frame. A held
// shot on a track (the shelf) glides along it instead: one more cartridge is not a new shot.
import { arcPose, mixPose, smoother } from "./rail";
import type { CameraPose, HeldShot } from "./types";

export const TWEEN_S = 1.1;
/** Half the veil: the cut happens while it is fully up. Matches .world-veil.is-cut in world.css. */
export const CUT_S = 0.16;
/** The glide along a track: a critically damped spring (rad/s); about 0.8 s to settle one step. */
export const GLIDE_W = 6;
/** A track move further than this (a filter, Ask SANT) is a new shot: it tweens round, not through every step. */
export const MAX_GLIDE = 3;

export interface ShotState {
  key: string | null;
  pose: CameraPose | null;
  /** `arc`: round the vertical axis (into a track's shot), not straight across. */
  tween: { from: CameraPose; start: number; arc: boolean } | null;
  cutAt: number | null;
  /** Where the camera is along the held shot's track, and how fast it is gliding; `seq` counts new shots. */
  glide: { id: string; at: number; v: number; seq: number } | null;
}

export const newShot = (): ShotState => ({ key: null, pose: null, tween: null, cutAt: null, glide: null });

/**
 * The held shot this frame: a plain one is its own pose, keyed by where it is. On a track, the camera
 * glides along it toward `track.at`; a new track, a far jump or a step with reduced motion is a new key.
 */
export function heldShot(s: ShotState, held: HeldShot, dt: number, reduced: boolean): { dest: CameraPose; key: string; arc: boolean; moving: boolean } {
  const track = held.track;
  if (!track) {
    s.glide = null;
    return { dest: held, key: heldKey(held), arc: false, moving: false };
  }
  const g = s.glide;
  let moving = false;
  if (!g || g.id !== track.id || Math.abs(track.at - g.at) > MAX_GLIDE || (reduced && track.at !== g.at)) {
    s.glide = { id: track.id, at: track.at, v: 0, seq: (g?.seq ?? 0) + 1 };
  } else if (g.at !== track.at || g.v !== 0) {
    // Critically damped: no overshoot, so the camera never swings back past a cartridge.
    const x = g.at - track.at;
    const e = Math.exp(-GLIDE_W * dt);
    const k = (g.v + GLIDE_W * x) * dt;
    g.at = track.at + (x + k) * e;
    g.v = (g.v - GLIDE_W * k) * e;
    if (Math.abs(g.at - track.at) < 1e-3 && Math.abs(g.v) < 1e-2) {
      g.at = track.at;
      g.v = 0;
    } else moving = true;
  }
  const glide = s.glide!;
  return { dest: track.pose(glide.at), key: `track:${track.id}:${glide.seq}`, arc: true, moving };
}

/** Take up the shot `key`: a new one starts a tween (or a cut). True when a cut starts. */
export function retarget(s: ShotState, dest: CameraPose, key: string, now: number, reduced: boolean, arc = false): boolean {
  if (s.pose === null) {
    s.pose = dest;
    s.key = key;
    return false;
  }
  if (key === s.key) return false;
  s.key = key;
  if (reduced) {
    s.cutAt = now + CUT_S;
    s.tween = null;
    return true;
  }
  s.tween = { from: s.pose, start: now, arc };
  s.cutAt = null;
  return false;
}

/** The pose this frame: held during a cut, mixed during a tween, else dest. */
export function mixShot(s: ShotState, dest: CameraPose, now: number): { pose: CameraPose; moving: boolean } {
  let pose = dest;
  let moving = false;
  if (s.cutAt !== null) {
    if (now < s.cutAt && s.pose) {
      pose = s.pose;
      moving = true;
    } else s.cutAt = null;
  } else if (s.tween) {
    const u = (now - s.tween.start) / TWEEN_S;
    if (u < 1) {
      pose = (s.tween.arc ? arcPose : mixPose)(s.tween.from, dest, smoother(u));
      moving = true;
    } else s.tween = null;
  }
  s.pose = pose;
  return { pose, moving };
}

/** A plain held shot's key: a new one tweens again (the tour's next stop). */
export const heldKey = (override: CameraPose) => `override:${override.position.join(",")}`;
