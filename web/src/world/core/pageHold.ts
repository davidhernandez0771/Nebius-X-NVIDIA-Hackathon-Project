// Whether the page holds still (no scroll): one answer from the world's state, applied by one owner
// (WorldRoot). In 3D it holds while the loader is up and, once the dive has landed, in the room view (the
// story ends there and the room is a game); an open branch holds it, and so does a held shot (the shelf,
// the detail view, the tour). Before, four effects (the loader's among them) each saved the page's
// overflow and put "their" old value back, so a stale value outlived what set it: the page stuck after
// leaving the shelf, or scrolled inside a branch the loader had finished under.
import type { Coarse } from "./store";

export function pageHeld(c: Pick<Coarse, "current" | "branch" | "override" | "ready">, workshopArrive: number, run3D: boolean): boolean {
  if (run3D && !c.ready) return true;
  if (c.branch !== null || c.override !== null) return true;
  return run3D && c.current === "workshop" && workshopArrive >= 1;
}
