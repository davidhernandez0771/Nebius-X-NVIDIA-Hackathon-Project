// Sending a spiral cartridge to the machine, shared by the 3D click and the overlay's buttons.
import { useWorld } from "../../core/WorldContext";
import { HELIX } from "../../scene/layout";
import { sendToMachine } from "../../scene/plug";
import { cartridgeAt } from "../../scene/robots";

/** Send one spiral slot to the machine: choose its cartridge, start the plug-in, follow it there. */
export function useSend(): (slot: number) => void {
  const { selectCartridge, goTo } = useWorld();
  return (slot) => {
    selectCartridge(cartridgeAt(HELIX[slot]));
    sendToMachine(slot);
    goTo("machine");
  };
}
