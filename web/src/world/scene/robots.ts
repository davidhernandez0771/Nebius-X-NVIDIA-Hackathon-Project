// The robots on the spiral. A cartridge's label carries a short code (layout.json); this is what the
// code stands for, what the label prints under it, and the cartridge the machine gets when one is
// chosen. Every robot opens Record for now: the 2D app has one recording page for all of them.
import type { Cartridge } from "../core/types";
import { HELIX, type HelixSlot } from "./layout";

export interface Robot {
  code: string;
  id: string;
  name: string;
  /** The small line under the code on the label. */
  spec: string;
  /** The label's status square. */
  mark: string;
}

export const ROBOTS: readonly Robot[] = [
  { code: "S101", id: "so101", name: "SO-101", spec: "SO-101 · 5-DOF + jaw · hobby arm", mark: "#3FD0B0" },
  { code: "FR3", id: "fr3", name: "Franka FR3", spec: "Franka FR3 · 7-DOF · research arm", mark: "#E6EDF3" },
  { code: "PPR", id: "piper", name: "PiPER", spec: "AgileX PiPER · 6-DOF · desktop arm", mark: "#3FD0B0" },
  { code: "RZ4", id: "rizon4", name: "Rizon 4", spec: "Flexiv Rizon 4 · 7-DOF · force arm", mark: "#7FD86B" },
  { code: "OPN", id: "openarm", name: "OpenArm", spec: "OpenArm · 7-DOF · open source", mark: "#E8A33D" },
];

const BY_CODE = new Map(ROBOTS.map((r) => [r.code, r]));

export function robotFor(code: string): Robot {
  const r = BY_CODE.get(code);
  if (!r) throw new Error(`world: no robot for label code "${code}"`);
  return r;
}

/** The cartridge in a spiral slot: what the machine projects and the route the zoom opens. */
export function cartridgeAt(slot: HelixSlot): Cartridge {
  const r = robotFor(slot.code);
  return { id: r.id, label: r.name, route: "/pm/record", slot: slot.index };
}

/**
 * The slot each robot's button sends (the keyboard path): the lowest one, so its flight to the
 * machine is short and stays in view.
 */
export function slotForRobot(code: string): HelixSlot {
  const slots = HELIX.filter((s) => s.code === code);
  if (slots.length === 0) throw new Error(`world: no spiral slot carries "${code}"`);
  return slots.reduce((a, b) => (b.position[1] < a.position[1] ? b : a));
}
