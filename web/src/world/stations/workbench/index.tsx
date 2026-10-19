// Workbench (T1, placeholder): a branch off the rail. "Add a cartridge" in the workshop flies the
// camera to Blender's "Workbench edit" stop over the baked bench (in the workshop's room); the editor
// will live in the overlay, and its live parts can come from workbench.glb. Back (or Escape) returns.
import { Button } from "../../../sant/components/Button";
import { still } from "../../core/layout";
import { useWorld } from "../../core/WorldContext";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { BENCH_PIVOT, stopFrom } from "../../scene/layout";
import { WorkbenchScene } from "./Scene";

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
  anchor: BENCH_PIVOT.position,
  travel: 0,
  length: 0,
  camera: still(stopFrom(BENCH_PIVOT.position, "Workbench edit")),
  Scene: WorkbenchScene,
  Overlay,
};

export default workbench;
