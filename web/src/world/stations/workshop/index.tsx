// Workshop: the room the descent builds out of particles, and where the scroll ends. The moment the descent has
// built it, the real room plays in over the particles through a glowing noise edge (scene/dissolve.ts, a short
// timed materialize), then the lamps flicker on and the hub is live; the travel is the camera's push in. From here the site is a
// game: the room view (Blender's "Workshop intro" stop, with a little mouse look) and four things to
// click: the spiral shelf (browse it in place, open a job, plug it in), the machine (it plugs one in
// and projects the robot), the bench (make a new cartridge) and the robot wall (the robots catalog).
// Escape always goes back one level.
import { lazy } from "react";
import { still } from "../../core/layout";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { stop } from "../../scene/layout";
import { HoverTip } from "../../ui/HoverTip";
import "./workshop.css";
import { AskBox } from "../../ask/AskBox";
import { Detail } from "./Detail";
import { Dock } from "./Dock";
import { HubBar } from "./HubBar";
import { hubTagLayer } from "./hubTagLayer";
import { useStepper } from "./stepper";
import { TourCaption } from "./TourCaption";

// The room's 3D mounts only once the loader is done (WorldCanvas), so its code (and the GLTF loader)
// loads then too, after the first frame (firstLoad.test.ts).
const WorkshopScene = lazy(() => import("./Scene").then((m) => ({ default: m.WorkshopScene })));

function Overlay(_: StationOverlayProps) {
  useStepper();
  return (
    <>
      <div className="world-hubtags" ref={(el) => void (hubTagLayer.current = el)} />
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
  // The push in from just behind the room view (descent/path.ts); the room is already there (scene/dissolve.ts).
  travel: 0.8,
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
