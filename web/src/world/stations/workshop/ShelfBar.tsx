// The shelf's way out (ui/StationBar): while it is browsed, "Back to room" closes it, with how to browse; under a
// detail view the same bar puts "Back to shelf" first (the detail's own Close, a wheel or Escape do the same).
// The shelf is the workshop's own state (stepper.ts), changed only with the held shot, so the store's and the
// spiral's notices are enough to follow it.
import { useCallback, useSyncExternalStore } from "react";
import { useWorld } from "../../core/WorldContext";
import { spiral, subscribeSpiral } from "../../scene/spiral";
import { StationBar } from "../../ui/StationBar";
import { useDetail } from "./detailStore";
import { closeShelf, shelf } from "./stepper";

export function ShelfBar() {
  const { store } = useWorld();
  const detail = useDetail();
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
  const on = useSyncExternalStore(subscribe, () => shelf.open && store.getCoarse().branch === null);
  const inDetail = useSyncExternalStore(subscribe, () => spiral.selected >= 0);
  const toRoom = () => {
    detail.close();
    closeShelf(store);
  };
  return (
    <StationBar
      on={on}
      title="The shelf"
      hint={inDetail ? "Plug it in, or scroll to close" : "Scroll or ↑ ↓ to browse"}
      back={toRoom}
      step={inDetail ? { label: "Back to shelf", onClick: () => detail.close() } : null}
    />
  );
}
