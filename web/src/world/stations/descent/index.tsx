// Descent (core): from Blender's "Descent" stop above the workshop (where the intro ends), scrolling down circles the
// camera once around the spiral shelf's axis, looking down into it, and drops toward the ceiling.
// It stops above the ceiling; the workshop's dive (stations/workshop/dive.ts) takes it in through the skylight.
// The spiral itself is the workshop's (its Scene reaches up here).
import type { CameraPose, StationModule, StationOverlayProps } from "../../core/types";
import { Beats } from "../../ui/Beats";
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

/** The proof, honest numbers only (the prototype's ITEMS; docs/superpowers/notes on the runs). */
function Overlay(_: StationOverlayProps) {
  return (
    <Beats
      station="descent"
      beats={[
        {
          from: 0.06,
          to: 0.94,
          className: "world-beat--stats",
          children: (
            <>
              <div>
                <b data-scramble>3/40</b>
                <span className="world-u">raw demos</span>
              </div>
              <div className="world-beat__arrow" aria-hidden="true">
                →
              </div>
              <div>
                <b data-scramble>17/40</b>
                <span className="world-u">multiplied · p = 0.0005</span>
              </div>
              <div>
                <b data-scramble>40/40</b>
                <span className="world-u">Nemotron labels</span>
              </div>
              <p className="world-beat__foot world-u">Same ACT policy · 40 unseen seeds · run once, pre-registered</p>
            </>
          ),
        },
      ]}
    />
  );
}

const descent: StationModule = {
  id: "descent",
  still: STILLS.descent,
  title: "Descent",
  owner: "core",
  kind: "rail",
  anchor: [0, 0, 0],
  // The intro ends on the Descent stop, so the spiral starts right there.
  travel: 0,
  length: 2.5,
  camera: spiral,
  rest: START,
  Overlay,
};

export default descent;
