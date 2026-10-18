// The four S·A·N·T steps and the state of each unit on the rail.

export const SANT_STEPS = [
  { letter: "S", name: "Simulate", hint: "Record with your hand; the sim arm follows" },
  { letter: "A", name: "Augment", hint: "Multiply verified demos into new scenes" },
  { letter: "N", name: "Neaten", hint: "Find and repair pauses, shake and bad grasps" },
  { letter: "T", name: "Train", hint: "Export to LeRobot and train a policy" },
] as const;

export type UnitState = "idle" | "active" | "done";

/** `active` is the current step (0–3), null for none, 4 when every step is done. */
export function unitState(index: number, active: number | null): UnitState {
  if (active === null) return "idle";
  if (index < active) return "done";
  return index === active ? "active" : "idle";
}
