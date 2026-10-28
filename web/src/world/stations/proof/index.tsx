// The proof wall (proof-wall, 2026-10-26, the user): a branch off the room view, like the machine, the bench and
// the robot wall. Its hub tag ("05 The proof"), the hub bar's Proof, the journey rail's PROOF, a click on the wall
// itself or #proof in the URL open it: the camera turns to the back wall and faces the results board square on
// (scene/proofWallPlan.ts), and the story's four proof figures step through as panels over it (Place.tsx). Back to
// room, Escape and the browser's Back return to the room view. The wall is part of the workshop's scene
// (scene/ProofWall.tsx), so it is there from every view.
import type { CameraPose, StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { Place } from "./Place";
import { PROOF_VIEW, PROOF_VIEW_PORTRAIT, portrait } from "./view";

export { PROOF_VIEW, PROOF_VIEW_PORTRAIT } from "./view";

function shot(): { key: string; pose: CameraPose } {
  return portrait() ? { key: "portrait", pose: PROOF_VIEW_PORTRAIT } : { key: "landscape", pose: PROOF_VIEW };
}

function Overlay({ current, reduced }: StationOverlayProps) {
  return <Place current={current} reduced={reduced} />;
}

const proof: StationModule = {
  id: "proof",
  still: STILLS.proof,
  title: "Proof",
  owner: "T6",
  kind: "branch",
  anchor: [0, 0, 0],
  travel: 0,
  length: 0,
  camera: () => (portrait() ? PROOF_VIEW_PORTRAIT : PROOF_VIEW),
  shot,
  Overlay,
};

export default proof;
