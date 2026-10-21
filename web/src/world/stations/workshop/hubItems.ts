// The room view's four things to click, and what each opens: the shelf browses the spiral in place
// (its first cartridge); the machine, the bench and the robot wall are branches. Shared by their 3D
// tags (HubTags) and the hub bar's buttons (HubBar), in this order (the room's Tab order).
import type { WorldApi } from "../../core/WorldContext";
import type { WorldStore } from "../../core/store";
import { scrollToStep } from "./stepper";

export type HubItem = "shelf" | "machine" | "bench" | "wall";

/** What each tag says: its number, its title, and the line under it (the cards, and the holograms' unfolded line). */
export const HUB_TAGS: readonly { id: HubItem; n: string; title: string; line: string }[] = [
  { id: "shelf", n: "01", title: "The shelf", line: "Every cartridge is a job. Pick one." },
  { id: "machine", n: "02", title: "The machine", line: "Drag a cartridge here. It projects the robot." },
  { id: "bench", n: "03", title: "The bench", line: "Make a new cartridge: name, look, robot." },
  { id: "wall", n: "04", title: "The wall", line: "The robots SANT runs on, and their parts." },
];

const BRANCH = { machine: "machine", bench: "workbench", wall: "robots" } as const;

export function openHubItem(id: HubItem, store: WorldStore, goTo: WorldApi["goTo"]): void {
  if (id === "shelf") scrollToStep(store, 0);
  else goTo(BRANCH[id]);
}
