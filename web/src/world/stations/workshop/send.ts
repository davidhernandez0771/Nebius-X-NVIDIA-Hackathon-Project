// Sending a spiral cartridge to the machine, and what a click on one does. Shared by the 3D click, the
// overlay's buttons and Ask SANT.
import { useWorld } from "../../core/WorldContext";
import { HELIX } from "../../scene/layout";
import { sendToMachine } from "../../scene/plug";
import { cartridgeAt } from "../../scene/robots";
import { N_ITEMS, ROBOT_SLOTS, cartridgeOfItem, matches, setFilter, slotOfItem, spiral } from "../../scene/spiral";
import { scrollToStep } from "./stepper";

/** Send one spiral slot to the machine: choose its cartridge, start the plug-in, follow it there. */
export function useSend(): (slot: number) => void {
  const { selectCartridge, goTo } = useWorld();
  return (slot) => {
    const k = slot;
    selectCartridge(cartridgeAt(HELIX[k]));
    sendToMachine(k);
    goTo("machine");
  };
}

/** Send a job to the machine (its plug-in), from wherever it sits on the helix now. */
export function useSendItem(): (item: number) => void {
  const { selectCartridge, goTo } = useWorld();
  return (item) => {
    selectCartridge(cartridgeOfItem(item));
    sendToMachine(slotOfItem(item));
    goTo("machine");
  };
}

/**
 * A click on a cartridge instance: a job steps the spiral to it (clearing a filter it doesn't match);
 * a robot goes to the machine, as before.
 */
export function usePick(): (instance: number) => void {
  const { store } = useWorld();
  const send = useSend();
  return (k) => {
    if (k >= N_ITEMS) return send(ROBOT_SLOTS[k - N_ITEMS]);
    if (!matches(k)) setFilter(null);
    scrollToStep(store, spiral.target[k]);
  };
}
