// Workshop (T6, placeholder): the room the descent reveals, with a shelf of cartridges. Picking one
// (in 3D or in the overlay) chooses what the machine projects; "Add a cartridge" opens the workbench.
import { Button } from "../../../sant/components/Button";
import { Box, PALETTE } from "../../core/Placeholder";
import { useWorld, useWorldState } from "../../core/WorldContext";
import type { Cartridge, StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { stop } from "../../scene/layout";
import { through } from "../../core/rail";

/** Placeholder shelf: each cartridge opens one of the app's real 2D routes. */
export const CARTRIDGES: Cartridge[] = [
  { id: "record", label: "Record", route: "/pm/record" },
  { id: "review", label: "Review", route: "/pm/review" },
  { id: "dataset", label: "Dataset", route: "/pm/dataset" },
];

function Scene() {
  const { selectCartridge } = useWorld();
  const chosen = useWorldState((c) => c.cartridge?.id ?? null);
  return (
    <group>
      <Box size={[30, 0.2, 22]} position={[0, -0.1, -2]} color="#0E1217" edge="#151A21" />
      <Box size={[30, 9, 0.3]} position={[0, 4.5, -8]} color="#0E1217" edge="#151A21" />
      {/* the shelf */}
      <Box size={[6, 0.25, 1.4]} position={[-1, 1.6, -3]} color={PALETTE.raised} />
      <Box size={[0.25, 1.6, 1.4]} position={[-3.9, 0.8, -3]} color={PALETTE.raised} />
      <Box size={[0.25, 1.6, 1.4]} position={[1.9, 0.8, -3]} color={PALETTE.raised} />
      {CARTRIDGES.map((c, i) => {
        const on = chosen === c.id;
        return (
          <Box
            key={c.id}
            name={`cartridge:${c.id}`}
            size={[1.1, 0.7, 0.9]}
            position={[-2.8 + i * 1.6, on ? 2.25 : 2.08, -3]}
            color={on ? PALETTE.accent : PALETTE.body}
            emissive={on ? 0.35 : 0}
            onClick={(e) => {
              e.stopPropagation();
              selectCartridge(c);
            }}
          />
        );
      })}
    </group>
  );
}

function Overlay(_: StationOverlayProps) {
  const { selectCartridge, goTo } = useWorld();
  const chosen = useWorldState((c) => c.cartridge?.id ?? null);
  return (
    <div className="world-panel">
      <h2 className="world-h">Workshop</h2>
      <p className="world-lede">Pick a cartridge for the machine.</p>
      <div className="world-choices" role="group" aria-label="Cartridges">
        {CARTRIDGES.map((c) => (
          <button key={c.id} type="button" className="sant-btn sant-btn--secondary sant-btn--sm world-choice" aria-pressed={chosen === c.id} onClick={() => selectCartridge(c)}>
            {c.label}
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={() => goTo("workbench")}>
        Add a cartridge
      </Button>
    </div>
  );
}

const workshop: StationModule = {
  id: "workshop",
  still: STILLS.workshop,
  title: "Workshop",
  owner: "T6",
  kind: "rail",
  anchor: [0, 0, 0],
  travel: 0.6,
  length: 1.5,
  // The room from the front, then the spiral shelf.
  camera: through(stop("Workshop intro"), stop("Tutorial 1 · shelf")),
  rest: stop("Workshop intro"),
  // The room stays drawn behind the machine and the zoom.
  reach: 2,
  Scene,
  Overlay,
};

export default workshop;
