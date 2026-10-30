// The room view's controls, top centre: how to play, and the way back up to the story. On a phone
// held upright the camera frames only the shelf (the other tags are off the sides), so the bar also
// carries the things to click as buttons; CSS shows them only there, and in the 2D fallback (the stills),
// where the tags are only drawn into the picture (data-flat). Hidden outside the room view, it is out of the
// Tab order and the accessibility tree too (inert), not only see-through.
import { useEffect, useRef } from "react";
import { inHub } from "../../core/CameraRig";
import { useWorld } from "../../core/WorldContext";
import { openHubItem, type HubItem } from "./hubItems";

const GO: { id: HubItem; label: string }[] = [
  { id: "shelf", label: "Shelf" },
  { id: "machine", label: "Machine" },
  { id: "bench", label: "Bench" },
  { id: "wall", label: "Robots" },
  { id: "proof", label: "Proof" },
];

export function HubBar() {
  const { store, goTo, mode } = useWorld();
  const flat = mode !== undefined && mode !== "3d";
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let shown: boolean | null = null;
    const apply = () => {
      const on = inHub(store);
      const el = bar.current;
      if (on === shown || !el) return;
      shown = on;
      el.dataset.on = String(on);
      el.toggleAttribute("inert", !on);
      if (on) el.removeAttribute("aria-hidden");
      else el.setAttribute("aria-hidden", "true");
    };
    apply();
    return store.onFrame(apply);
  }, [store]);
  const toStory = () => {
    // The story is above: unlock the page (WorldRoot) and go back to its first section.
    store.setOverride(null);
    window.dispatchEvent(new CustomEvent("world:story"));
  };
  return (
    <div ref={bar} className="world-hubbar world-u" data-on="false" data-flat={flat}>
      <span className="world-hubbar__hint">
        {flat ? (
          "Pick a place to go in · Esc comes back out"
        ) : (
          <>
            Click a tag to go in · Esc comes back out<span className="world-hubbar__more"> · or drag a cartridge onto the machine</span>
          </>
        )}
      </span>
      <span className="world-hubbar__go" role="group" aria-label="Go to">
        {GO.map((g) => (
          <button key={g.id} type="button" data-hub={g.id} onClick={() => openHubItem(g.id, store, goTo)}>
            {g.label}
          </button>
        ))}
      </span>
      <button type="button" onClick={toStory}>↑ Story</button>
    </div>
  );
}
