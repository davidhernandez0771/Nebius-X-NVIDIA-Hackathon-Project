// The detail view: a job's cartridge comes right out of the spiral and the camera closes in on it,
// with its info block bottom left. Scrolling, Escape or "Close" puts it back; "Plug in" runs the
// machine's plug-in and carries on into the projection (plug.autoplay).
import { useWorld } from "../../core/WorldContext";
import { sendToMachine } from "../../scene/plug";
import { cartridgeOfItem, matches, setFilter, setSelected, slotOfItem, spiral } from "../../scene/spiral";
import { detailView } from "./camera";
import { scrollToStep, shelfView } from "./stepper";

export interface DetailApi {
  open(item: number): void;
  close(): void;
  plugIn(item: number): void;
}

export function useDetail(): DetailApi {
  const { store, selectCartridge, goTo, mode, handoff } = useWorld();
  const close = () => {
    if (spiral.selected < 0) return;
    setSelected(-1);
    // Back to the shelf it was opened from, or the room view.
    store.setOverride(shelfView());
  };
  return {
    open(item) {
      if (!matches(item)) setFilter(null);
      // The scroll goes to its step underneath, so closing lands there.
      scrollToStep(store, spiral.target[item]);
      setSelected(item);
      store.setOverride(detailView(spiral.target[item]));
    },
    close,
    plugIn(item) {
      close();
      selectCartridge(cartridgeOfItem(item));
      // Without the canvas there is no plug-in to watch: open the page now.
      if (mode !== "3d") return handoff();
      sendToMachine(slotOfItem(item), true);
      goTo("machine");
    },
  };
}
