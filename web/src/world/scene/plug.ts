// Which spiral cartridge is going to the machine, shared between the spiral (which hides that slot
// once it has left) and the machine (which flies it in and plugs it, plugSequence.ts). Mutated in
// place; the machine writes `progress` every frame it draws.
import { DEFAULT_CARTRIDGE } from "../core/layout";

export const plug = {
  /** The slot on its way or plugged in. Before anyone chooses: the default cartridge's. */
  slot: DEFAULT_CARTRIDGE.slot ?? 0,
  /** A click asked for this slot; the machine starts the timed sequence on its next frame. */
  requested: false,
  /** 0–1 through the whole sequence (0: in the spiral, 1: plugged in and projecting). */
  progress: 0,
};

/** Send a spiral slot to the machine (a click on it, or its robot's button). */
export function sendToMachine(slot: number): void {
  plug.slot = slot;
  plug.requested = true;
}

export function resetPlug(): void {
  plug.slot = DEFAULT_CARTRIDGE.slot ?? 0;
  plug.requested = false;
  plug.progress = 0;
}
