// Machine: the GPU-shaped console from machine.glb. Over its dwell the camera goes from the side to
// the port and back to the projection: the cartridge plugs in by the "Plug in" stop and the
// hologram lights above the lens, in PROJECTION, where the zoom flies in (Scene.tsx).
import { DEFAULT_CARTRIDGE, MACHINE_ANCHOR, MACHINE_VIEW } from "../../core/layout";
import { useWorldState } from "../../core/WorldContext";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { stopFrom } from "../../scene/layout";
import { through } from "../../core/rail";
import { MachineScene } from "./Scene";

function Overlay(_: StationOverlayProps) {
  const label = useWorldState((c) => (c.cartridge ?? DEFAULT_CARTRIDGE).label);
  return (
    <div className="world-panel">
      <h2 className="world-h">Machine</h2>
      <p className="world-lede">{label} plugs in. Keep scrolling to go into the projection.</p>
    </div>
  );
}

const machine: StationModule = {
  id: "machine",
  still: STILLS.machine,
  title: "Machine",
  owner: "T7",
  kind: "rail",
  anchor: MACHINE_ANCHOR,
  travel: 0.8,
  length: 1.6,
  // The machine from the side, the port close up, then the projection: MACHINE_VIEW, where the zoom starts.
  camera: through(stopFrom(MACHINE_ANCHOR, "Tutorial 2 · machine"), stopFrom(MACHINE_ANCHOR, "Plug in"), MACHINE_VIEW),
  rest: MACHINE_VIEW,
  Scene: MachineScene,
  Overlay,
};

export default machine;
