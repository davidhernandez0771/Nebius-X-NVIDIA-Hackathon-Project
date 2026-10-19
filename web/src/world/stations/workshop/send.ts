// Sending a spiral cartridge to the machine, and what a click on one does. Shared by the 3D click, the
// overlay's buttons and Ask SANT.
import { useWorld } from "../../core/WorldContext";
import { sendToMachine } from "../../scene/plug";
import { cartridgeInSlot } from "../../scene/saved";
import { N_ITEMS, instanceSlot } from "../../scene/spiral";
import { useDetail } from "./detailStore";

/** Send one spiral slot to the machine: choose its cartridge, start the plug-in, follow it there. */
export function useSend(): (slot: number) => void {
  const { selectCartridge, goTo } = useWorld();
  return (slot) => {
    selectCartridge(cartridgeInSlot(slot));
    sendToMachine(slot);
    goTo("machine");
  };
}

/** A click on a cartridge instance: a job opens its detail view; a robot or a saved one goes to the machine. */
export function usePick(): (instance: number) => void {
  const send = useSend();
  const detail = useDetail();
  return (k) => (k >= N_ITEMS ? send(instanceSlot(k)) : detail.open(k));
}
