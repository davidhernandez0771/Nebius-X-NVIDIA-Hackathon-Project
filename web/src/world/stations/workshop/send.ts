// Sending a spiral cartridge to the machine, and what a click on one does. Shared by the 3D click, the
// overlay's buttons and Ask SANT.
import { useWorld } from "../../core/WorldContext";
import { HELIX } from "../../scene/layout";
import { sendToMachine } from "../../scene/plug";
import { cartridgeAt } from "../../scene/robots";
import { N_ITEMS, ROBOT_SLOTS } from "../../scene/spiral";
import { useDetail } from "./detail";

/** Send one spiral slot to the machine: choose its cartridge, start the plug-in, follow it there. */
export function useSend(): (slot: number) => void {
  const { selectCartridge, goTo } = useWorld();
  return (slot) => {
    selectCartridge(cartridgeAt(HELIX[slot]));
    sendToMachine(slot);
    goTo("machine");
  };
}

/** A click on a cartridge instance: a job opens its detail view; a robot goes to the machine, as before. */
export function usePick(): (instance: number) => void {
  const send = useSend();
  const detail = useDetail();
  return (k) => (k >= N_ITEMS ? send(ROBOT_SLOTS[k - N_ITEMS]) : detail.open(k));
}
