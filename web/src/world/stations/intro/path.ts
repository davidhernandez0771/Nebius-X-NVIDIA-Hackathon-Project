// The intro's camera, by vh (storyPlan.ts): straight down through the stacked places. It holds on the
// hero, sinks below the logo and lands on the forest floor at eye height, walks to the crack and looks
// into it, drops down the fissure through the rock, comes out under the cavern's ceiling and circles
// the core, sinking, while the reactor powers up; then it moves over the axis, above THE RING, looking
// down into it, where the descent dives through. Its height never rises as the scroll goes on, so every
// drop is a fall, and scrolling back up plays it in reverse. Pure, so the tests hold it to the places.
import { mixPose, smoother } from "../../core/rail";
import type { CameraPose } from "../../core/types";
import { CAVERN, CRACK, FOREST, HERO_VIEW, THE_RING } from "./layout";
import { INTRO_VH, progress, span } from "./storyPlan";

const F = FOREST.floor;
const [AX, AZ] = CAVERN.axis;

/** The end of the hero: a little closer to the logo. */
const HERO_END: CameraPose = { ...HERO_VIEW, position: [HERO_VIEW.position[0], HERO_VIEW.position[1], HERO_VIEW.position[2] - 2] };

const [CX, CZ] = CRACK.center;

/** Landed in the forest at eye height, looking along the floor toward the crack. */
const LAND: CameraPose = { position: [6, F + 2.4, 58], target: [-2.9, F + 0.6, 50], fov: 46 };

/** At the crack's edge, looking down into it. */
const EDGE: CameraPose = { position: [CX + 3, F + 2.3, CZ + 6.5], target: [CX, F - 0.5, CZ], fov: 46 };

/** Over the crack, looking straight down the fissure (a little off vertical, so the camera's roll holds). */
const OVER: CameraPose = { position: [CX + 0.4, F + 1.5, CZ + 0.9], target: [CX - 0.3, F - 18, CZ - 0.6], fov: 50 };

/** Where the crack's span hovers over the fissure before the fall. */
const OVER_AT = 0.35;

/** The reactor's circle round the core: from under the crack, out and round, sinking. */
const ORBIT = { a0: Math.atan2(CX - AX, CZ - AZ), sweep: (200 * Math.PI) / 180, r0: Math.hypot(CX - AX, CZ - AZ), r1: 17, y0: 82, y1: 72.5, look0: 46, look1: 49, fov0: 50, fov1: 44 } as const;

function orbit(k: number): CameraPose {
  const u = smoother(k);
  const a = ORBIT.a0 + ORBIT.sweep * u;
  const r = ORBIT.r0 + (ORBIT.r1 - ORBIT.r0) * u;
  return {
    position: [AX + Math.sin(a) * r, ORBIT.y0 + (ORBIT.y1 - ORBIT.y0) * u, AZ + Math.cos(a) * r],
    target: [AX, ORBIT.look0 + (ORBIT.look1 - ORBIT.look0) * u, AZ],
    fov: ORBIT.fov0 + (ORBIT.fov1 - ORBIT.fov0) * u,
  };
}

/**
 * The proof stage: the camera keeps circling the powered core, slowly, a little lower, while the proof beats hold the
 * screen. It starts where the reactor's orbit ends (and as still), so the hand-over has no kink.
 */
const DRIFT = { sweep: (30 * Math.PI) / 180, drop: 1 } as const;

function drift(k: number): CameraPose {
  const end = orbit(1);
  const u = smoother(k);
  const a = ORBIT.a0 + ORBIT.sweep + DRIFT.sweep * u;
  return {
    position: [AX + Math.sin(a) * ORBIT.r1, ORBIT.y1 - DRIFT.drop * u, AZ + Math.cos(a) * ORBIT.r1],
    target: end.target,
    fov: end.fov,
  };
}

/** Where the intro ends: above THE RING, looking down into it. The descent starts from here. */
export const PORTAL_VIEW: CameraPose = {
  position: [THE_RING.center[0], THE_RING.center[1] + 19.5, THE_RING.center[2] + 4.2],
  target: THE_RING.center,
  fov: 40,
};

const ease = (a: CameraPose, b: CameraPose, k: number) => mixPose(a, b, smoother(k));

export function cameraAt(vh: number): CameraPose {
  if (vh <= 0) return HERO_VIEW;
  if (vh >= INTRO_VH) return PORTAL_VIEW;
  if (vh < span("hero")[1]) return ease(HERO_VIEW, HERO_END, progress("hero", vh));
  if (vh < span("sink")[1]) return ease(HERO_END, LAND, progress("sink", vh));
  if (vh < span("forest")[1]) return ease(LAND, EDGE, progress("forest", vh));
  if (vh < span("crack")[1]) {
    const k = progress("crack", vh);
    if (k < OVER_AT) return ease(EDGE, OVER, k / OVER_AT);
    return ease(OVER, orbit(0), (k - OVER_AT) / (1 - OVER_AT));
  }
  if (vh < span("reactor")[1]) return orbit(progress("reactor", vh));
  if (vh < span("proof")[1]) return drift(progress("proof", vh));
  return ease(drift(1), PORTAL_VIEW, progress("ring", vh));
}

/**
 * The camera's way across the forest, as points on the ground (x, z): from where it comes down among
 * the trunks to where it drops into the rock. The trees keep clear of it (forestPlan.ts).
 */
export function walkXZ(): [number, number][] {
  const out: [number, number][] = [];
  const [a] = span("sink");
  const [, b] = span("crack");
  for (let vh = a; vh <= b; vh += 0.002) {
    const p = cameraAt(vh).position;
    if (p[1] > F + FOREST.canopy + 2 || p[1] < F) continue;
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[2]) > 0.4) out.push([p[0], p[2]]);
  }
  return out;
}
