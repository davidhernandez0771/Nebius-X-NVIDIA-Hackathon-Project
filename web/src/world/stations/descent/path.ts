// The descent's camera: above THE RING as the intro leaves it, a dive straight down through its opening
// while it bursts into particles (the reactor goes dark round it), then the long fall down the shaft in
// front of the room's open wall (it is never flown through) to just behind and above the room view,
// turning from looking down to looking in. The workshop's travel takes over there while the room
// materializes. Its height only ever drops. Pure, so the rail's tests cover it.
import { mixPose, smoother } from "../../core/rail";
import type { CameraPose } from "../../core/types";
import { stop } from "../../scene/layout";
import { THE_RING } from "../intro/layout";
import { PORTAL_VIEW } from "../intro/path";

const HUB = stop("Workshop intro");
const [RX, RY, RZ] = THE_RING.center;

/** Where the dive through the ring ends (the descent's t). */
export const PUSH_AT = 0.28;
/** Where the fall lands (the descent's t); it holds there to the end. */
const LAND_AT = 0.9;

/** Just through the ring, still looking down the shaft (a little off vertical, so the roll holds). */
const PUSH: CameraPose = { position: [RX, RY - 6, RZ + 0.6], target: [RX, RY - 30, RZ - 1.5], fov: 50 };

/** Behind and above the room view: the workshop's travel pushes in from here as the room appears. */
export const HUB_FAR: CameraPose = {
  position: [HUB.position[0], HUB.position[1] + 2.4, HUB.position[2] + 7],
  target: HUB.target,
  fov: HUB.fov,
};

export function descentCamera(t: number): CameraPose {
  if (t <= 0) return PORTAL_VIEW;
  if (t <= PUSH_AT) return mixPose(PORTAL_VIEW, PUSH, smoother(t / PUSH_AT));
  if (t >= LAND_AT) return HUB_FAR;
  return mixPose(PUSH, HUB_FAR, smoother((t - PUSH_AT) / (LAND_AT - PUSH_AT)));
}
