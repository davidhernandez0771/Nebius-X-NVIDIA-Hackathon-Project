// The shelf's way out (ui/StationBar): while it is browsed (not under a detail view, which has its own
// Close), "Back to room" closes it, with how to browse. The shelf is the workshop's own state (stepper.ts),
// changed only with the held shot, so the store's and the spiral's notices are enough to follow it.
import { useCallback, useSyncExternalStore } from "react";
import { useWorld } from "../../core/WorldContext";
import { spiral, subscribeSpiral } from "../../scene/spiral";
import { StationBar } from "../../ui/StationBar";
import { closeShelf, shelf } from "./stepper";

export function ShelfBar() {
  const { store } = useWorld();
  const subscribe = useCallback(
    (fn: () => void) => {
      const a = store.subscribe(fn);
      const b = subscribeSpiral(fn);
      return () => {
        a();
        b();
      };
    },
    [store],
  );
  const on = useSyncExternalStore(subscribe, () => shelf.open && spiral.selected < 0 && store.getCoarse().branch === null);
  return <StationBar on={on} title="The shelf" hint="Scroll or ↑ ↓ to browse" back={() => closeShelf(store)} />;
}
