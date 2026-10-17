// Effects on/off and reduced motion. Motion is reduced when the OS asks
// (prefers-reduced-motion) or the user turns effects off. Spec: docs/design/motion.md §3.

export type Effects = "on" | "off";

export const EFFECTS_KEY = "sant.effects";

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function resolveMotion({ prefersReduced, effects }: { prefersReduced: boolean; effects: Effects }) {
  return { reduced: prefersReduced || effects === "off" };
}

export function readEffects(storage: StorageLike | undefined): Effects {
  try {
    return storage?.getItem(EFFECTS_KEY) === "off" ? "off" : "on";
  } catch {
    return "on";
  }
}

export function writeEffects(storage: StorageLike | undefined, effects: Effects): void {
  try {
    storage?.setItem(EFFECTS_KEY, effects);
  } catch {
    // Private windows and blocked site data: the choice lasts for this page only.
  }
}
