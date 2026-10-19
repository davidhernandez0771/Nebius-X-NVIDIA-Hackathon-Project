// Descent (core): scrolling down spirals the camera around a shaft, from the story above to the
// workshop below. One full turn, so it ends facing the workshop the way it started.
import { Box, PALETTE } from "../../core/Placeholder";
import type { CameraPose, StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";

const TOP = 36;
const BOTTOM = 7;
const RADIUS = 10;
const TURNS = 1;
const STEPS = 44;
const STEP_RADIUS = 4.6;
/** The shaft and the stair stop at the workshop's ceiling, so the room below stays clear. */
const CEILING = 9;

/** The spiral: the camera circles the shaft once while dropping from TOP to BOTTOM, looking in and down. */
export function spiral(t: number): CameraPose {
  const a = t * TURNS * Math.PI * 2;
  const y = TOP + (BOTTOM - TOP) * t;
  return { position: [RADIUS * Math.sin(a), y, RADIUS * Math.cos(a)], target: [0, y - 3, 0], fov: 44 };
}

function Scene() {
  // A spiral stair of boxes around the shaft, turning the same way as the camera so it reads as a descent.
  const steps = Array.from({ length: STEPS }, (_, i) => {
    const u = i / (STEPS - 1);
    const a = u * Math.PI * 2 * 2.5;
    const y = TOP + 2 + (CEILING - TOP - 2) * u;
    return { a, y, key: i };
  });
  return (
    <group>
      <Box size={[1.4, TOP + 3 - CEILING, 1.4]} position={[0, (TOP + 3 + CEILING) / 2, 0]} color={PALETTE.body} />
      {steps.map(({ a, y, key }) => (
        <Box key={key} size={[2.2, 0.18, 0.9]} position={[STEP_RADIUS * Math.sin(a), y, STEP_RADIUS * Math.cos(a)]} rotation={[0, a, 0]} color={PALETTE.raised} />
      ))}
    </group>
  );
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
  rest: { position: [0, 22, 16], target: [0, 16, 0], fov: 44 },
  Scene,
  Overlay,
};

export default descent;
