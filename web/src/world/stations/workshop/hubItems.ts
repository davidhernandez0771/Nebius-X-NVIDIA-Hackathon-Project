// The room view's five things to click, and what each opens: the shelf browses the spiral in place
// (its first cartridge); the machine, the bench, the robot wall and the proof wall are branches. Shared by
// their 3D tags (HubTags) and the hub bar's buttons (HubBar), in this order (the room's Tab order).
import type { WorldApi } from "../../core/WorldContext";
import type { WorldStore } from "../../core/store";
import { CLIMB } from "../../../site/results/proofData";
import { scrollToStep } from "./stepper";

export type HubItem = "shelf" | "machine" | "bench" | "wall" | "proof";

const V2 = CLIMB[CLIMB.length - 1];

/** What each tag says: its number, its title, and the line under it (the cards, and the holograms' unfolded line). */
export const HUB_TAGS: readonly { id: HubItem; n: string; title: string; line: string }[] = [
  { id: "shelf", n: "01", title: "The shelf", line: "Every cartridge is a job. Pick one." },
  { id: "machine", n: "02", title: "The machine", line: "Drag a cartridge here. It projects the robot." },
  { id: "bench", n: "03", title: "The bench", line: "Make a new cartridge: name, look, robot." },
  { id: "wall", n: "04", title: "The wall", line: "The robots SANT runs on, and their parts." },
  // proof-wall (2026-10-26, the user): the story's proof, as a place on the back wall.
  { id: "proof", n: "05", title: "The proof", line: `${CLIMB[0].k}/${CLIMB[0].n} → ${V2.k}/${V2.n}, pre-registered. How we know.` },
];

const BRANCH = { machine: "machine", bench: "workbench", wall: "robots", proof: "proof" } as const;

export function openHubItem(id: HubItem, store: WorldStore, goTo: WorldApi["goTo"]): void {
  if (id === "shelf") scrollToStep(store, 0);
  else goTo(BRANCH[id]);
}
