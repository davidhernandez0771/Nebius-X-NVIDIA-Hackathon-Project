// Machine: the GPU-shaped console from machine.glb, a branch of the workshop (a click on it, or PLUG
// IN on a cartridge). It plays when it opens: the camera goes from the side to the port and back to
// the projection while the cartridge plugs in, and the hologram (the robot twin in particles) lights
// above the lens, in PROJECTION, where the zoom flies in.
import { DEFAULT_CARTRIDGE, MACHINE_ANCHOR, MACHINE_VIEW } from "../../core/layout";
import { lazy, useEffect } from "react";
import { Button } from "../../../sant/components/Button";
import { useWorld, useWorldState } from "../../core/WorldContext";
import { StationBar } from "../../ui/StationBar";
import { plug, sendToMachine } from "../../scene/plug";
import { PLUG_S } from "../../scene/plugSequence";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { stopFrom } from "../../scene/layout";
import { through } from "../../core/rail";

// The machine's 3D (and the hologram) mounts after the loader, so its code loads then (firstLoad.test.ts).
const MachineScene = lazy(() => import("./Scene").then((m) => ({ default: m.MachineScene })));

function Overlay({ current }: StationOverlayProps) {
  const { goTo, back } = useWorld();
  const label = useWorldState((c) => (c.cartridge ?? DEFAULT_CARTRIDGE).label);
  // Opened from the room view with nothing chosen: plug in the one that's waiting (the default).
  useEffect(() => {
    if (current && !plug.requested && plug.progress < 1) sendToMachine(plug.slot);
  }, [current]);
  return (
    <>
      <StationBar on={current} title="The machine" hint="Watch it plug in" back={back} />
      <div className="world-panel">
        <h2 className="world-h">Machine</h2>
        <p className="world-lede">{label} plugs in, and the machine projects its robot: a real, physics-checked demo, replayed.</p>
        <div className="world-panel__row">
          <Button onClick={() => goTo("zoom")}>Into the projection →</Button>
        </div>
      </div>
    </>
  );
}

const machine: StationModule = {
  id: "machine",
  still: STILLS.machine,
  title: "Machine",
  owner: "T7",
  kind: "branch",
  anchor: MACHINE_ANCHOR,
  travel: 0,
  length: 0,
  // Plays once it opens: the machine from the side, the port close up as it plugs in, then the projection.
  duration: PLUG_S + 0.8,
  camera: through(stopFrom(MACHINE_ANCHOR, "Tutorial 2 · machine"), stopFrom(MACHINE_ANCHOR, "Plug in"), MACHINE_VIEW),
  rest: MACHINE_VIEW,
  Scene: MachineScene,
  Overlay,
};

export default machine;
