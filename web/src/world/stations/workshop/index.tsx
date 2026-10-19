// Workshop: the room the descent comes down into, with the spiral shelf of robot cartridges in the
// middle, the machine to the right and the bench to the left. Pointing at a cartridge lifts it;
// clicking it (or its robot's button below, the keyboard path) sends it to the machine, and the
// journey moves on to the machine to watch it plug in. "Add a cartridge" opens the workbench.
import { Button } from "../../../sant/components/Button";
import { through } from "../../core/rail";
import { useWorld, useWorldState } from "../../core/WorldContext";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { stop } from "../../scene/layout";
import { ROBOTS, slotForRobot } from "../../scene/robots";
import { WorkshopScene } from "./Scene";
import { useSend } from "./send";

function Overlay(_: StationOverlayProps) {
  const { goTo } = useWorld();
  const send = useSend();
  const chosen = useWorldState((c) => c.cartridge?.id ?? null);
  return (
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
  length: 1.5,
  // The room from the front, then the spiral shelf.
  camera: through(stop("Workshop intro"), stop("Tutorial 1 · shelf")),
  rest: stop("Workshop intro"),
  // The room stays drawn behind the machine and the zoom.
  reach: 2,
  Scene: WorkshopScene,
  Overlay,
};

export default workshop;
