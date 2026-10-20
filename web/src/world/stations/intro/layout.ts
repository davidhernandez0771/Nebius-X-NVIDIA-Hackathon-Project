// Where the opening happens, in the workshop's coordinates (Y-up metres, the floor at y = -0.6, the
// room's open front at z = 13). The logo hangs high above the room, where Blender's "Title" stop looks,
// in a dark space of its own: nothing of the room shows until the transition builds it.
import { stop } from "../../scene/layout";
import type { Vec3 } from "../../core/types";

/** The prototype's numbers are for a camera 16.5 from the logo; Blender's Title stop is 22 away. */
export const LOGO_SCALE = 22 / 16.5;
/** The logo's centre: what the Title stop looks at. */
export const LOGO: Vec3 = stop("Title").target;

/**
 * The logo ring in the prototype's units (scaled by LOGO_SCALE): the mark's arcs run on it too, and its
 * tube is as thick as their stroke, so it closes over them in the morph.
 */
export const RING = { radius: 4.2, tube: 0.37 } as const;

/** The ring's radius in world metres, which is also the 3D logo's scale (logo3d.ts: the arcs at 1). */
export const LOGO_R = RING.radius * LOGO_SCALE;

/** The dust: a column around the logo's space, from the room's floor to above the logo. */
export const DUST = { radius: 22, y0: -0.6, height: 42 } as const;
