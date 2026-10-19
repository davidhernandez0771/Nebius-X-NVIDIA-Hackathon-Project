// Zoom to UI (core): the camera dollies from MACHINE_VIEW (Blender's "Projection" stop) to its
// "Zoom to UI" stop, square in front of the projection and close enough that it fills the view; a DOM screen in the app's ground fades up over it, and at the end of the play the route
// changes to the cartridge's 2D page (core/handoff.ts). The button is the same handoff, now.
import { useRef } from "react";
import { Button } from "../../../sant/components/Button";
import { DEFAULT_CARTRIDGE, MACHINE_ANCHOR, MACHINE_VIEW, PROJECTION, inFront } from "../../core/layout";
import { screenOpacity } from "../../core/handoff";
import { mixPose, smoother } from "../../core/rail";
import { useStationFrame, useWorld, useWorldState } from "../../core/WorldContext";
import type { CameraPose, StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { stopFrom } from "../../scene/layout";

/** Blender's "Zoom to UI" stop, on the projection's normal, closer than the fill distance. */
export const CLOSE: CameraPose = stopFrom(MACHINE_ANCHOR, "Zoom to UI");

function Overlay(_: StationOverlayProps) {
  const { handoff } = useWorld();
  const label = useWorldState((c) => (c.cartridge ?? DEFAULT_CARTRIDGE).label);
  const screen = useRef<HTMLDivElement>(null);
  useStationFrame("zoom", (f) => {
    if (screen.current) screen.current.style.opacity = String(screenOpacity(f.t));
  });
  return (
    <>
      <div ref={screen} className="world-handoff" aria-hidden="true">
        <span className="world-handoff__title">{label}</span>
      </div>
      <div className="world-panel world-panel--zoom">
        <Button onClick={handoff}>Open {label}</Button>
      </div>
    </>
  );
}

const zoom: StationModule = {
  id: "zoom",
  still: STILLS.zoom,
  title: "Into the projection",
  owner: "core",
  kind: "branch",
  anchor: MACHINE_ANCHOR,
  travel: 0,
  length: 0,
  // Plays once it opens (the machine's button, or PLUG IN carrying on): the dolly in, then the page.
  duration: 2.4,
  camera: (t) => mixPose(MACHINE_VIEW, CLOSE, smoother(t)),
  rest: { position: inFront(5), target: PROJECTION.center, fov: MACHINE_VIEW.fov },
  Overlay,
};

export default zoom;
