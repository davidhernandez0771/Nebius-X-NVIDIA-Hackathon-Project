// Workshop: the room the descent comes down into, and where the scroll ends. From here the site is a
// game: the room view (Blender's "Workshop intro" stop, with a little mouse look) and three things to
// click: the spiral shelf (browse it in place, open a job, plug it in), the machine (it plugs one in
// and projects the robot), and the bench (make a new cartridge). Escape always goes back one level.
import { still } from "../../core/layout";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { stop } from "../../scene/layout";
import { HoverTip } from "../../ui/HoverTip";
import { CUT_AT, diveEnter } from "./dive";
import { WorkshopScene } from "./Scene";
import "./workshop.css";
import { AskBox } from "../../ask/AskBox";
import { Detail } from "./Detail";
import { Dock } from "./Dock";
import { HubBar } from "./HubBar";
import { useStepper } from "./stepper";
import { TourCaption } from "./TourCaption";

function Overlay(_: StationOverlayProps) {
  useStepper();
  return (
    <>
      <HoverTip />
      <h2 className="world-sr">Workshop</h2>
      <HubBar />
      <Dock>
        <AskBox />
      </Dock>
      <Detail />
      <TourCaption />
    </>
  );
}

const HUB = stop("Workshop intro");

const workshop: StationModule = {
  id: "workshop",
  still: STILLS.workshop,
  title: "Workshop",
  owner: "T6",
  kind: "rail",
  anchor: [0, 0, 0],
  // In through the skylight, behind a mask (dive.ts): a longer travel, so the dive reads.
  travel: 1.1,
  enter: diveEnter,
  cutAt: CUT_AT,
  // The end of the scroll: the room view. From here it's clicks (the shelf, the machine, the bench).
  length: 0.25,
  camera: still(HUB),
  rest: HUB,
  // The room stays drawn behind the machine, the zoom and the bench.
  reach: 3,
  Scene: WorkshopScene,
  Overlay,
};

export default workshop;
