// The descent's camera: square on to the ring as the intro leaves it, a push into the burst while the
// particles fill the dark, then the long drop down in front of the room's open wall (it is never flown
// through) to just behind and above the room view, where the workshop's travel takes over while the
// room materializes. Pure, so the rail's tests cover it.
import { mixPose, smoother } from "../../core/rail";
import type { CameraPose } from "../../core/types";
import { stop } from "../../scene/layout";
import { PORTAL_VIEW } from "../intro/storyPlan";

const HUB = stop("Workshop intro");

/** Where the push into the burst ends (the descent's t). */
export const PUSH_AT = 0.28;
/** Where the drop lands (the descent's t); it holds there to the end. */
const LAND_AT = 0.9;

const PUSH: CameraPose = { position: [0, 36, 16.5], target: [0, 35.4, 2], fov: 44 };

/** Behind and above the room view: the workshop's travel pushes in from here as the room appears. */
export const HUB_FAR: CameraPose = {
  position: [HUB.position[0], HUB.position[1] + 2.4, HUB.position[2] + 7],
  target: HUB.target,
  fov: HUB.fov,
};

export function descentCamera(t: number): CameraPose {
  if (t <= PUSH_AT) return mixPose(PORTAL_VIEW, PUSH, smoother(t / PUSH_AT));
  if (t >= LAND_AT) return HUB_FAR;
  return mixPose(PUSH, HUB_FAR, smoother((t - PUSH_AT) / (LAND_AT - PUSH_AT)));
}
