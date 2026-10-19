// Workshop: the room the descent comes down into, with the spiral shelf in the middle (the jobs at
// the top, the robots under them, an arm inside), the machine to the right and the bench to the left.
// The scroll steps down the spiral one cartridge at a time (stepper.ts, camera.ts). Pointing at one
// lifts it and scrambles its title in the tip; clicking a job steps to it; a robot (or its button in
// the dock, the keyboard path) goes to the machine. The dock's filters reorder the spiral; "Add a
// cartridge" opens the workbench.
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { stop } from "../../scene/layout";
import { Beats } from "../../ui/Beats";
import { HoverTip } from "../../ui/HoverTip";
import { LENGTH_VH, tOfStep, workshopCamera } from "./camera";
import { WorkshopScene } from "./Scene";
import "./workshop.css";
import { Dock } from "./Dock";
import { useStepper } from "./stepper";

function Overlay(_: StationOverlayProps) {
  useStepper();
  return (
    <>
      <Beats
        station="workshop"
        beats={[
          {
            from: 0,
            to: tOfStep(0) * 0.85,
            children: (
              <>
                <h2 data-scramble>The workshop.</h2>
                <p>Every cartridge is a job. Pick one and plug it in, or ask.</p>
              </>
            ),
          },
        ]}
      />
      <HoverTip />
      <h2 className="world-sr">Workshop</h2>
      <Dock />
    </>
  );
}

const workshop: StationModule = {
  id: "workshop",
  still: STILLS.workshop,
  title: "Workshop",
  owner: "T6",
  kind: "rail",
  anchor: [0, 0, 0],
  travel: 0.6,
  length: LENGTH_VH,
  // The room from the front, then down the spiral one cartridge per step.
  camera: workshopCamera,
  rest: stop("Workshop intro"),
  follow: true,
  // The room stays drawn behind the machine and the zoom.
  reach: 2,
  Scene: WorkshopScene,
  Overlay,
};

export default workshop;
