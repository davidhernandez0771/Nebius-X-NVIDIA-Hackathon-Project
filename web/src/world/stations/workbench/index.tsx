// Workbench (T1): a branch off the room view. "Add a cartridge" (or a click on the bench) flies the
// camera over the baked bench, where the editor (Editor.tsx) builds a new cartridge in five stages while
// the bench in 3D follows (Scene.tsx). Each stage has its own shot (layout.ts shotFor), framed beside
// the editor: the row of blanks, then the turntable, the robot's hologram, the label. Finish stands it
// on the spiral; Back (or Escape) returns to the room view.
import { still } from "../../core/layout";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { useWorld } from "../../core/WorldContext";
import { StationBar } from "../../ui/StationBar";
import { STILLS } from "../../scene/assets";
import { BENCH_PIVOT, stopFrom } from "../../scene/layout";
import { bench, type Stage } from "./draft";
import { Editor } from "./Editor";
import { FINALE } from "./finale";
import { shotFor } from "./layout";
import { WorkbenchScene } from "./Scene";

/**
 * The stage's shot for this window, made again only when either changes. A save holds the name's close
 * shot through the click, the light and the sparks, then pulls back as the cartridge leaves.
 */
let last: { stage: Stage; aspect: number; shot: { key: string; pose: ReturnType<typeof shotFor> } } | null = null;
function shot() {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const clicking = bench.stage === "done" && performance.now() - bench.savedAt < FINALE.flyAt * 1000;
  const stage: Stage = clicking ? "name" : bench.stage;
  if (!last || last.stage !== stage || last.aspect !== aspect) last = { stage, aspect, shot: { key: stage, pose: shotFor(stage, aspect) } };
  return last.shot;
}

function Overlay({ current }: StationOverlayProps) {
  const { back } = useWorld();
  return (
    <>
      <StationBar on={current} title="The bench" hint="Make a new cartridge" back={back} />
      <Editor current={current} />
    </>
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
  shot,
  Scene: WorkbenchScene,
  Overlay,
};

export default workbench;
