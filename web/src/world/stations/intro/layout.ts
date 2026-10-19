// Where the opening happens, in the workshop's coordinates (Y-up metres, the floor at y = -0.6, the
// ceiling at 14.4 with its round opening over the spiral). The logo hangs where Blender's "Title" stop
// looks; its particles end as a lattice dome over the ceiling, around and through the opening, and the
// ring settles on the opening's rim (the skylight).
import { stop } from "../../scene/layout";
import type { CameraPose, Vec3 } from "../../core/types";

/** The prototype's numbers are for a camera 16.5 from the logo; Blender's Title stop is 22 away. */
export const LOGO_SCALE = 22 / 16.5;
/** The logo's centre: what the Title stop looks at. */
export const LOGO: Vec3 = stop("Title").target;

/** The roof lattice: a shallow dome over the ceiling, centred on the spiral's axis. */
export const ROOF = { y: 14.55, rise: 2.4, radius: 12, ringStep: 2.4, spokes: 18 } as const;

/** The ceiling's opening over the spiral, where the ring ends as the skylight's rim. */
export const SKYLIGHT = { center: [0, 14.32, 0] as Vec3, radius: 4.75 } as const;

/** The logo ring in the prototype's units (scaled by LOGO_SCALE in the logo). */
export const RING = { radius: 4.2, tube: 0.3 } as const;

/** The dust: a column around the whole journey, from the floor to above the logo. */
export const DUST = { radius: 22, y0: -0.6, height: 42 } as const;

const DESCENT = stop("Descent");

/**
 * The intro's camera stops: the logo square on (Blender's Title), a turn round it, over the top, then
 * down onto Blender's "Descent" stop looking into the skylight, where the descent takes over.
 */
export const INTRO_STOPS: CameraPose[] = [
  stop("Title"),
  { position: [10.5, 35.2, 19], target: [0, 35.4, 2], fov: 40 },
  { position: [6, 34, 10.5], target: [0, 26, 1.5], fov: 40 },
  DESCENT,
];
