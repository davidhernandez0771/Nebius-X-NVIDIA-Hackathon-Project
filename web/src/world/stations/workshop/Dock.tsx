// The dock, bottom left over the spiral: "What are you looking for?" and the six tags. A tag slides
// its cartridges along the helix to the top slots, dims the rest and limits the scroll to them
// (spiral.ts, stepper.ts); pressing it again, or Escape, clears it. Under the tags: the robots'
// own cartridges and the bench (the keyboard path to what is clickable in 3D), and Ask SANT.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useStationFrame, useWorld } from "../../core/WorldContext";
import { TAGS, type TagId } from "../../scene/items";
import { ROBOTS, slotForRobot } from "../../scene/robots";
import { setFilter, spiral, subscribeSpiral } from "../../scene/spiral";
import { tOfStep } from "./camera";
import { useSend } from "./send";
import { scrollToStep } from "./stepper";

const filterNow = () => spiral.filter;

/** Set or clear a filter, and bring the spiral back to its first step. */
export function useFilter(): (tag: TagId | null) => void {
  const { store } = useWorld();
  return (tag) => {
    setFilter(tag);
    scrollToStep(store, 0);
  };
}

export function Dock({ children }: { children?: ReactNode }) {
  const { goTo, store } = useWorld();
  const filter = useSyncExternalStore(subscribeSpiral, filterNow);
  const pickFilter = useFilter();
  const send = useSend();
  const dock = useRef<HTMLDivElement>(null);

  // Shown while the spiral is being browsed: not over the way in, a branch or the detail view.
  const refresh = () => {
    const f = store.frames.workshop;
    const c = store.getCoarse();
    const on = f.current && f.t >= tOfStep(0) * 0.85 && c.ready && c.branch === null && c.override === null && spiral.selected < 0;
    if (dock.current && dock.current.dataset.on !== String(on)) dock.current.dataset.on = String(on);
  };
  useStationFrame("workshop", refresh);
  useEffect(() => {
    const a = subscribeSpiral(refresh);
    const b = store.subscribe(refresh);
    return () => {
      a();
      b();
    };
  });

  // Escape clears the filter (the detail view takes Escape first while it is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || spiral.selected >= 0 || spiral.filter === null) return;
      if (!store.frames.workshop.current) return;
      pickFilter(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, pickFilter]);

  return (
    <div ref={dock} className="world-dock" data-on="false">
      <h3 className="world-u world-dock__h">What are you looking for?</h3>
      <ul className="world-dock__filters world-u" role="group" aria-label="Filter the cartridges">
        {TAGS.map((t) => (
          <li key={t.id}>
            <button type="button" aria-pressed={filter === t.id} data-tag={t.id} onClick={() => pickFilter(filter === t.id ? null : t.id)}>
              -&gt; {t.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="world-dock__robots world-u" role="group" aria-label="Robots">
        {ROBOTS.map((r) => (
          <button key={r.id} type="button" onClick={() => send(slotForRobot(r.code).index)}>
            {r.name}
          </button>
        ))}
        <button type="button" className="world-dock__bench" onClick={() => goTo("workbench")}>
          + Add a cartridge
        </button>
      </div>
      {children}
    </div>
  );
}
