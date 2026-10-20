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
  /** PLUG IN: once it is in, carry on into the projection and open the cartridge's page. */
  autoplay: false,
  /** It was dragged onto the machine: it waits over the port instead of flying from its slot (plugSequence.ts). */
  held: false,
};

/** Send a spiral slot to the machine (a click on it, its robot's button, or a drop over the port: held). */
export function sendToMachine(slot: number, autoplay = false, held = false): void {
  plug.slot = slot;
  plug.requested = true;
  plug.autoplay = autoplay;
  plug.held = held;
}

export function resetPlug(): void {
  plug.slot = DEFAULT_CARTRIDGE.slot ?? 0;
  plug.requested = false;
  plug.progress = 0;
  plug.autoplay = false;
  plug.held = false;
}
