// Workbench (T1, placeholder): a branch off the rail. "Add a cartridge" in the workshop flies the
// camera here; the editor will live in the overlay. Back (or Escape) returns to the rail.
import { Button } from "../../../sant/components/Button";
import { Box, PALETTE } from "../../core/Placeholder";
import { still } from "../../core/layout";
import { useWorld } from "../../core/WorldContext";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";

function Scene() {
  return (
    <group>
      <Box size={[4.4, 0.18, 2]} position={[0, 0.95, 0]} color={PALETTE.raised} />
      {[-2, 2].flatMap((x) => [-0.85, 0.85].map((z) => <Box key={`${x}${z}`} size={[0.14, 0.9, 0.14]} position={[x, 0.45, z]} />))}
      <Box size={[1.1, 0.7, 0.9]} position={[0, 1.4, 0]} color={PALETTE.violet} emissive={0.3} />
    </group>
  );
}

function Overlay(_: StationOverlayProps) {
  const { back } = useWorld();
  return (
    <div className="world-panel">
      <h2 className="world-h">Workbench</h2>
      <p className="world-lede">Placeholder: the cartridge editor goes here.</p>
      <Button variant="secondary" size="sm" onClick={back}>
        Back to the workshop
      </Button>
    </div>
  );
}

const workbench: StationModule = {
  id: "workbench",
  still: STILLS.workbench,
  title: "Workbench",
  owner: "T1",
  kind: "branch",
  anchor: [-9, 0, 1],
  travel: 0,
  length: 0,
  camera: still({ position: [0, 2.6, 5.2], target: [0, 1.0, 0], fov: 40 }),
  Scene,
  Overlay,
};

export default workbench;
