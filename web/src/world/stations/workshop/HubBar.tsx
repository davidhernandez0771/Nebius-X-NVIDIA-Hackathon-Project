// The room view's controls, top centre: how to play, and the way back up to the story. On a phone
// held upright the camera frames only the shelf (the machine's and the bench's tags are off the
// sides), so the bar also carries the three things to click as buttons; CSS shows them only there.
import { useEffect, useRef } from "react";
import { inHub } from "../../core/CameraRig";
import { useWorld } from "../../core/WorldContext";
import { openHubItem, type HubItem } from "./hubItems";

const GO: { id: HubItem; label: string }[] = [
  { id: "shelf", label: "Shelf" },
  { id: "machine", label: "Machine" },
  { id: "bench", label: "Bench" },
];

export function HubBar() {
  const { store, goTo } = useWorld();
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let shown = false;
    return store.onFrame(() => {
      const on = inHub(store);
      if (on === shown || !bar.current) return;
      shown = on;
      bar.current.dataset.on = String(on);
    });
  }, [store]);
  const toStory = () => {
    // The story is above: unlock the page (WorldRoot) and go back to its first section.
    store.setOverride(null);
    window.dispatchEvent(new CustomEvent("world:story"));
  };
  return (
    <div ref={bar} className="world-hubbar world-u" data-on="false">
      <span className="world-hubbar__hint">Click the shelf, the machine or the bench · Esc goes back</span>
      <span className="world-hubbar__go" role="group" aria-label="Go to">
        {GO.map((g) => (
          <button key={g.id} type="button" onClick={() => openHubItem(g.id, store, goTo)}>
            {g.label}
          </button>
        ))}
      </span>
      <button type="button" onClick={toStory}>↑ Story</button>
    </div>
  );
}
