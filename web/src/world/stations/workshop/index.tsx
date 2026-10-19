// Workshop: the room the descent comes down into, with the spiral shelf in the middle (the jobs at
// the top, the robots under them, an arm inside), the machine to the right and the bench to the left.
// The scroll steps down the spiral one cartridge at a time (stepper.ts, camera.ts). Pointing at one
// lifts it and scrambles its title in the tip; clicking a job steps to it; a robot (or its button
// below, the keyboard path) goes to the machine. "Add a cartridge" opens the workbench.
import { Button } from "../../../sant/components/Button";
import { useWorld, useWorldState } from "../../core/WorldContext";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { stop } from "../../scene/layout";
import { Beats } from "../../ui/Beats";
import { HoverTip } from "../../ui/HoverTip";
import { LENGTH_VH, tOfStep, workshopCamera } from "./camera";
import { ROBOTS, slotForRobot } from "../../scene/robots";
import { WorkshopScene } from "./Scene";
import { useSend } from "./send";
import { useStepper } from "./stepper";

function Overlay(_: StationOverlayProps) {
  const { goTo } = useWorld();
  const send = useSend();
  const chosen = useWorldState((c) => c.cartridge?.id ?? null);
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
    <div className="world-panel world-panel--workshop">
      <h2 className="world-h">Workshop</h2>
      <p className="world-lede">Every robot is a cartridge. Pick one and plug it into the machine.</p>
      <ol className="world-steps">
        <li>
          <strong>Pick a robot.</strong> Point at a cartridge on the spiral, or choose one here.
        </li>
        <li>
          <strong>Plug it in.</strong> The machine reads it and opens Record, where you teach it by showing.
        </li>
        <li>
          <strong>Add a cartridge.</strong> At the bench: pick a shell, name it, upload your robot.
        </li>
      </ol>
      <div className="world-choices" role="group" aria-label="Robots">
        {ROBOTS.map((r) => (
          <button key={r.id} type="button" className="sant-btn sant-btn--secondary sant-btn--sm world-choice" aria-pressed={chosen === r.id} onClick={() => send(slotForRobot(r.code).index)}>
            {r.name}
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={() => goTo("workbench")}>
        Add a cartridge
      </Button>
    </div>
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
