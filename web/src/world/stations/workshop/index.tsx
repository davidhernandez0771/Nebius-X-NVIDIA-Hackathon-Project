// Workshop: the room the descent builds out of particles, and where the scroll ends. Its travel is the
// materialize: the camera pushes in a little while the real room appears over the particles through a
// glowing noise edge (scene/dissolve.ts), then the lamps flicker on and the hub is live. From here the site is a
// game: the room view (Blender's "Workshop intro" stop, with a little mouse look) and three things to
// click: the spiral shelf (browse it in place, open a job, plug it in), the machine (it plugs one in
// and projects the robot), and the bench (make a new cartridge). Escape always goes back one level.
import { useEffect, useRef } from "react";
import { inHub } from "../../core/CameraRig";
import { still } from "../../core/layout";
import { useWorld } from "../../core/WorldContext";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { stop } from "../../scene/layout";
import { HoverTip } from "../../ui/HoverTip";
import { WorkshopScene } from "./Scene";
import "./workshop.css";
import { AskBox } from "../../ask/AskBox";
import { Detail } from "./Detail";
import { Dock } from "./Dock";
import { useStepper } from "./stepper";
import { TourCaption } from "./TourCaption";

/** The room view's controls, bottom centre: how to play, and the way back up to the story. */
function HubBar() {
  const { store } = useWorld();
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let shown = false;
    return store.onFrame(() => {
      const on = inHub(store);
      if (on === shown || !bar.current) return;
      shown = on;
      bar.current.dataset.on = String(on);
    });
  }, [store]);
  const toStory = () => {
    // The story is above: unlock the page (WorldRoot) and go back to its first section.
    store.setOverride(null);
    window.dispatchEvent(new CustomEvent("world:story"));
  };
  return (
    <div ref={bar} className="world-hubbar world-u" data-on="false">
      <span>Click the shelf, the machine or the bench · Esc goes back</span>
      <button type="button" onClick={toStory}>↑ Story</button>
    </div>
  );
}

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
  // The materialize (scene/dissolve.ts revealAt), from just behind the room view (descent/path.ts).
  travel: 1.4,
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
