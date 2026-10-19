// The way into the workshop, as Active Theory moves between floors: never a fly-over, always a
// masked change (docs/design/references/activetheory.md). From the descent's last view down into the
// skylight the camera dives at the ring, the view widening as it falls, while the frame closes to dark
// from the edges with the roof's particles streaming past (Portal.tsx). At full dark it cuts inside the
// room; the dark opens from the centre, and the camera settles on Blender's "Workshop intro" stop as
// the lamps boot. Pure, so the rail's tests cover it.
import { mixPose, smoother } from "../../core/rail";
import type { CameraPose, Vec3 } from "../../core/types";
import { SKYLIGHT } from "../intro/layout";
import { stop } from "../../scene/layout";

/** The travel t where the camera cuts, inside the fully dark span. */
export const CUT_AT = 0.5;
/** The frame is fully dark from CLOSED_FROM to CLOSED_TO. */
export const CLOSED_FROM = 0.4;
export const CLOSED_TO = 0.6;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** How much of the frame the dark covers at travel t: closes from the edges, opens from the centre. */
export function cover(t: number): number {
  if (t <= CUT_AT) return smoothstep(0.06, CLOSED_FROM, t);
  return 1 - smoothstep(CLOSED_TO, 0.96, t);
}

/** The dive's end: just above the opening's centre, still clear of the ceiling, looking straight down. */
const OVER_RING: Vec3 = [SKYLIGHT.center[0], SKYLIGHT.center[1] + 2.2, SKYLIGHT.center[2] + 0.01];
const RING_FLOOR: Vec3 = [SKYLIGHT.center[0], -0.6, SKYLIGHT.center[2]];
const DIVE_FOV = 74;

const INTRO = stop("Workshop intro");
/** Where the camera comes out: a little above and behind the intro stop, wide, settling onto it. */
const EMERGE: CameraPose = {
  position: [INTRO.position[0], INTRO.position[1] + 3.5, INTRO.position[2] + 5],
  target: INTRO.target,
  fov: 64,
};

export function diveEnter(t: number, from: CameraPose): CameraPose {
  if (t < CUT_AT) {
    const u = smoother(t / CUT_AT);
    const dive: CameraPose = { position: OVER_RING, target: RING_FLOOR, fov: DIVE_FOV };
    return mixPose(from, dive, u);
  }
  return mixPose(EMERGE, INTRO, smoother((t - CUT_AT) / (1 - CUT_AT)));
}
