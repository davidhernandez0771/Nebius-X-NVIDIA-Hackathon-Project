// Descent (core): from Blender's "Descent" stop above the workshop, scrolling down circles the
// camera once around the spiral shelf's axis, looking down into it, and drops toward the ceiling.
// It stops above the ceiling, so the travel into the room comes in over the open front wall.
// The spiral itself is the workshop's (its Scene reaches up here).
import type { CameraPose, StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { stop } from "../../scene/layout";

const START = stop("Descent");
const RADIUS = Math.hypot(START.position[0], START.position[2]);
const A0 = Math.atan2(START.position[0], START.position[2]);
const TOP = START.position[1];
const BOTTOM = 20;
const TURNS = 1;
/** How far the look-at point sinks down the spiral over the turn. */
const SINK = 2;

/** The spiral: one turn around the axis while dropping from the Descent stop to BOTTOM. */
export function spiral(t: number): CameraPose {
  const a = A0 + t * TURNS * Math.PI * 2;
  const y = TOP + (BOTTOM - TOP) * t;
  return { position: [RADIUS * Math.sin(a), y, RADIUS * Math.cos(a)], target: [START.target[0], START.target[1] - SINK * t, START.target[2]], fov: START.fov };
}

function Overlay(_: StationOverlayProps) {
  return (
    <div className="world-panel world-panel--quiet">
      <p className="world-lede">Down to the workshop.</p>
    </div>
  );
}

const descent: StationModule = {
  id: "descent",
  still: STILLS.descent,
  title: "Descent",
  owner: "core",
  kind: "rail",
  anchor: [0, 0, 0],
  travel: 0.6,
  length: 2.5,
  camera: spiral,
  rest: START,
  Overlay,
};

export default descent;
