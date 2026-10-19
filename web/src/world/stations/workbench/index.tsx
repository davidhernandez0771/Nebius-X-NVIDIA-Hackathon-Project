// Workbench (T1): a branch off the room view. "Add a cartridge" (or a click on the bench) flies the
// camera to Blender's "Workbench edit" stop over the baked bench, where the editor (Editor.tsx) names
// a new cartridge and picks its shell and robot while the one on the turntable follows (Scene.tsx).
// Save stands it on the spiral; Back (or Escape) returns to the room view.
import { still } from "../../core/layout";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { BENCH_PIVOT, stopFrom } from "../../scene/layout";
import { Editor } from "./Editor";
import { WorkbenchScene } from "./Scene";

function Overlay({ current }: StationOverlayProps) {
  return <Editor current={current} />;
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
