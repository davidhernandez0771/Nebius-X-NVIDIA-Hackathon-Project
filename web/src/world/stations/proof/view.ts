// The proof wall's camera (proof-wall, 2026-10-26): square in front of the results board (scene/proofWallPlan.ts).
// On a landscape screen the vertical field of view is fixed (core/fov.ts widens it only when upright), so the
// screen always spans the same share of the viewport's height: the place's panel (Place.tsx) is laid exactly over
// it from SCREEN_IN_VH, and reads as the screen's own content. Upright, the camera stands back to fit the width.
import type { CameraPose } from "../../core/types";
import { PROOF_WALL } from "../../scene/proofWallPlan";

const FOV = 40;
/** How far in front of the screen the camera stands: landscape, and upright. */
const DIST = 11.1;
const DIST_UPRIGHT = 17;
const [CX, CY, CZ] = PROOF_WALL.center;

export const PROOF_VIEW: CameraPose = { position: [CX, CY, CZ + DIST], target: PROOF_WALL.center, fov: FOV };
export const PROOF_VIEW_PORTRAIT: CameraPose = { position: [CX, CY, CZ + DIST_UPRIGHT], target: PROOF_WALL.center, fov: FOV };

/** The screen's size from PROOF_VIEW on a landscape screen, in viewport heights (centred on the viewport). */
export const SCREEN_IN_VH = (() => {
  const span = 2 * DIST * Math.tan(((FOV / 2) * Math.PI) / 180);
  return { w: PROOF_WALL.width / span, h: PROOF_WALL.height / span };
})();

/** Held upright (narrower than tall): the portrait pose. */
export const portrait = () => typeof window !== "undefined" && window.innerWidth < window.innerHeight;
