// Robots (T5): a branch off the room view. A click on a side wall (or "The wall" tag, or the hub bar's
// Robots) turns the camera to the left wall, where the five robots of the catalog stand on the middle
// shelf, and the catalog panel (Panel.tsx) lists them: maker, arm, gripper, what each does in SANT
// today, and whether it was tested in Isaac or is planned. Hovering a robot on the wall or its row
// highlights both (hot.ts); Escape and Back return to the room view. The wall itself is part of the
// workshop's scene (scene/RobotWall.tsx), so it is there from every view.
import type { CameraPose, StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { Panel } from "./Panel";

/**
 * Standing over the bench, looking square at the left wall: the catalog panel on the left of a
 * landscape screen, the five robots between it and the journey rail on the right (view.test.ts), the
 * three shelves top to bottom. The bench stays under the frame.
 */
export const ROBOTS_VIEW: CameraPose = { position: [-7.9, 6.4, 2.75], target: [-20.8, 6.1, 2.75], fov: 55 };

/**
 * A screen held upright (a phone): the panel is a sheet over the bottom half, so the camera centres on
 * the robots' row and looks lower, which lifts the row above the sheet (view.test.ts). The portrait
 * field of view (core/fov.ts) is narrow across: the middle robots show, the ends need a pan.
 */
export const ROBOTS_VIEW_PORTRAIT: CameraPose = { position: [-7.9, 6.4, -1.05], target: [-20.8, 3.2, -1.05], fov: 55 };

const portrait = () => typeof window !== "undefined" && window.innerWidth < window.innerHeight * 0.8;

function Overlay({ current, reduced }: StationOverlayProps) {
  return <Panel current={current} reduced={reduced} />;
}

const robots: StationModule = {
  id: "robots",
  still: STILLS.robots,
  title: "Robots",
  owner: "T5",
  kind: "branch",
  anchor: [0, 0, 0],
  travel: 0,
  length: 0,
  camera: () => (portrait() ? ROBOTS_VIEW_PORTRAIT : ROBOTS_VIEW),
  Overlay,
};

export default robots;
