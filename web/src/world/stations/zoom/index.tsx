// Zoom to UI (core): the camera dollies from MACHINE_VIEW into the projection until it fills the
// view; a DOM screen in the app's ground fades up over it, and at the end of the rail the route
// changes to the cartridge's 2D page (core/handoff.ts). The button is the same handoff, now.
import { useRef } from "react";
import { Button } from "../../../sant/components/Button";
import { DEFAULT_CARTRIDGE, MACHINE_ANCHOR, MACHINE_VIEW, PROJECTION, fillDistance } from "../../core/layout";
import { screenOpacity } from "../../core/handoff";
import { mixPose, smoother } from "../../core/rail";
import { useStationFrame, useWorld, useWorldState } from "../../core/WorldContext";
import type { CameraPose, StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";

const [cx, cy, cz] = PROJECTION.center;
/** Closer than the fill distance, so a wide window is covered edge to edge too. */
export const CLOSE: CameraPose = { position: [cx, cy, cz + fillDistance(MACHINE_VIEW.fov) * 0.8], target: [cx, cy, cz], fov: MACHINE_VIEW.fov };

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
  kind: "rail",
  anchor: MACHINE_ANCHOR,
  travel: 0,
  length: 1.4,
  camera: (t) => mixPose(MACHINE_VIEW, CLOSE, smoother(t)),
  rest: { position: [cx, cy, cz + 5], target: [cx, cy, cz], fov: MACHINE_VIEW.fov },
  Overlay,
};

export default zoom;
