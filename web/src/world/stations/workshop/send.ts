// Sending a spiral cartridge to the machine, and what a click on one does. Shared by the 3D click, the
// drag onto the machine (Dragged.tsx), the overlay's buttons and Ask SANT.
import { useWorld } from "../../core/WorldContext";
import type { Cartridge } from "../../core/types";
import { sendToMachine } from "../../scene/plug";
import { cartridgeInSlot } from "../../scene/saved";
import { N_ITEMS, cartridgeOfItem, instanceSlot, itemInSlot } from "../../scene/spiral";
import { useDetail } from "./detailStore";

/** What the machine gets for the cartridge in a spiral slot: a job's page, or a robot's or a saved one's. */
export function cartridgeForSlot(slot: number): Cartridge {
  const item = itemInSlot(slot);
  return item >= 0 ? cartridgeOfItem(item) : cartridgeInSlot(slot);
}

/**
 * Send one spiral slot to the machine: choose its cartridge, start the plug-in, follow it there.
 * `held`: it was dropped over the port, so it waits there instead of flying from its slot.
 */
export function useSend(): (slot: number, opts?: { held?: boolean }) => void {
  const { selectCartridge, goTo } = useWorld();
  return (slot, opts) => {
    selectCartridge(cartridgeForSlot(slot));
    sendToMachine(slot, opts?.held ?? false);
    goTo("machine");
  };
}

/** A click on a cartridge instance: a job opens its detail view; a robot or a saved one goes to the machine. */
export function usePick(): (instance: number) => void {
  const send = useSend();
  const detail = useDetail();
  return (k) => (k >= N_ITEMS ? send(instanceSlot(k)) : detail.open(k));
}
