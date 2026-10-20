// Where the opening happens, in the workshop's coordinates (Y-up metres, the floor at y = -0.6, the
// room's open front at z = 13). The story is a descent through places stacked above the room, each in
// its own dark, with rock or empty black between them (storyPlan.ts lights one at a time):
//   the hero: the glass logo, high up, where Blender's "Title" stop looks, raised by HERO_LIFT;
//   the forest: a misty floor of dark trunks with robot parts in the moss, and a crack in it;
//   the rock: the crack's fissure, straight down;
//   the reactor: a cavern with a vertical core, whose top ring lifts off at full power to become THE RING;
//   the room: the descent (stations/descent) dives through THE RING and the particles build the workshop.
import { stop } from "../../scene/layout";
import type { CameraPose, Vec3 } from "../../core/types";

const TITLE = stop("Title");

/** How far the hero hangs above Blender's "Title" stop: the forest, the rock and the reactor fit between. */
export const HERO_LIFT = 144;

const lift = (v: Vec3): Vec3 => [v[0], v[1] + HERO_LIFT, v[2]];

/** The logo's centre: what the hero looks at. */
export const LOGO: Vec3 = lift(TITLE.target);

/** The hero: Blender's Title framing of the logo, raised with it. */
export const HERO_VIEW: CameraPose = { position: lift(TITLE.position), target: LOGO, fov: TITLE.fov };

/** The prototype's numbers are for a camera 16.5 from the logo; Blender's Title stop is 22 away. */
export const LOGO_SCALE = 22 / 16.5;

/**
 * The logo ring in the prototype's units (scaled by LOGO_SCALE): the mark's arcs run on it too, and its
 * tube is as thick as their stroke. THE RING has the same tube.
 */
export const RING = { radius: 4.2, tube: 0.37 } as const;

/** The ring's radius in world metres, which is also the 3D logo's scale (logo3d.ts: the arcs at 1). */
export const LOGO_R = RING.radius * LOGO_SCALE;

/** The dust: a sparse column round the logo's space only (the places below have their own). */
export const DUST = { radius: 22, y0: LOGO[1] - 26, height: 46 } as const;

/** A point on the ground plane (x, z). */
export type XZ = readonly [number, number];

/** The forest: a floor of trunks round the clearing the camera lands in; trunks rise `canopy` metres. */
export const FOREST = { floor: 118, center: [0, 30] as XZ, radius: 46, canopy: 30 } as const;

/**
 * The crack in the forest floor: its centre, its direction (radians about y, from +x toward -z), and its
 * half length and half width. Its fissure runs straight down through the rock to the cavern's ceiling.
 */
export const CRACK = { center: [-13, 37] as XZ, angle: 0.5, halfLength: 6.5, halfWidth: 1.7 } as const;

/** The reactor's cavern: a round hall round the core's vertical axis, in front of the room's open wall. */
export const CAVERN = { axis: [0, 34] as XZ, floor: 20, ceiling: 86, radius: 30 } as const;

/** The rock between the forest floor and the cavern's ceiling: the crack's fissure is the only way through. */
export const ROCK = { top: FOREST.floor, bottom: CAVERN.ceiling } as const;

/** The core: a glass column of light on the cavern's axis. */
export const CORE = { bottom: 22, top: 48, radius: 2.2 } as const;

/** A horizontal ring round the cavern's axis: its centre and radius (world metres). */
export interface RingPlace {
  center: Vec3;
  radius: number;
}

/** The core's top ring at rest, round its cap. */
export const TOP_RING: RingPlace = { center: [CAVERN.axis[0], CORE.top + 0.6, CAVERN.axis[1]], radius: 3.3 };

/** THE RING: where the top ring lifts to at full power, the logo ring's size. The descent dives through it. */
export const THE_RING: RingPlace = { center: [CAVERN.axis[0], CORE.top + 4, CAVERN.axis[1]], radius: LOGO_R };

/** THE RING's tube radius in world metres (as thick as the logo's arcs). */
export const RING_TUBE = RING.tube * LOGO_SCALE;
