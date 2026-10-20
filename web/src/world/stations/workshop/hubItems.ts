// The room view's four things to click, and what each opens: the shelf browses the spiral in place
// (its first cartridge); the machine, the bench and the robot wall are branches. Shared by their 3D
// tags (HubTags) and the hub bar's buttons (HubBar), in this order (the room's Tab order).
import type { WorldApi } from "../../core/WorldContext";
import type { WorldStore } from "../../core/store";
import { scrollToStep } from "./stepper";

export type HubItem = "shelf" | "machine" | "bench" | "wall";

const BRANCH = { machine: "machine", bench: "workbench", wall: "robots" } as const;

export function openHubItem(id: HubItem, store: WorldStore, goTo: WorldApi["goTo"]): void {
  if (id === "shelf") scrollToStep(store, 0);
  else goTo(BRANCH[id]);
}
