// The room view's three things to click, and what each opens: the shelf browses the spiral in place
// (its first cartridge), the machine and the bench are branches. Shared by their 3D tags (HubTags)
// and the hub bar's buttons (HubBar).
import type { WorldApi } from "../../core/WorldContext";
import type { WorldStore } from "../../core/store";
import { scrollToStep } from "./stepper";

export type HubItem = "shelf" | "machine" | "bench";

export function openHubItem(id: HubItem, store: WorldStore, goTo: WorldApi["goTo"]): void {
  if (id === "shelf") scrollToStep(store, 0);
  else goTo(id === "machine" ? "machine" : "workbench");
}
