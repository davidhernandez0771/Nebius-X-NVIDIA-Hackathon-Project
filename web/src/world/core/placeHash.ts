// The open place in the URL's hash (#machine, #workbench, #robots), so the browser's own Back (a phone's back
// gesture, a mouse's back button) closes a place in the workshop instead of leaving the site, Forward opens it
// again, and a reload (or a shared link) opens it in the room. Before, the places never touched the history:
// Back from the machine left the site, and a reload dropped you at the top of the story.
// The zoom counts as the machine (it plays out of it, and reopened it would hand off to Record at once).
// Pure, so the rules are tested; WorldRoot applies them.
import type { StationId } from "./types";

const PLACES: readonly StationId[] = ["machine", "workbench", "robots"];

/** The place a hash names, or null ("#zoom" too: it is never written). */
export function placeOfHash(hash: string): StationId | null {
  const id = hash.replace(/^#/, "") as StationId;
  return PLACES.includes(id) ? id : null;
}

/** The hash for the open branch ("" with none open). */
export function hashOfBranch(branch: StationId | null): string {
  if (branch === null) return "";
  if (branch === "zoom") return "#machine";
  return PLACES.includes(branch) ? `#${branch}` : "";
}

export type HistoryOp = { op: "none" } | { op: "push" | "replace"; hash: string } | { op: "back" };

/**
 * What the history does when the open branch changes. Opening a place adds an entry (from another place it
 * replaces that one, so one Back always reaches the room). Closing one by its own Back or Escape pops the entry
 * the world added (so the history stays in step with the room), or, for an entry the world didn't add (a reload,
 * a link), just drops the hash.
 */
export function syncOp(branch: StationId | null, hash: string, ownEntry: boolean): HistoryOp {
  const want = hashOfBranch(branch);
  const have = placeOfHash(hash) ? hash : "";
  if (want === have) return { op: "none" };
  if (want) return { op: have ? "replace" : "push", hash: want };
  return ownEntry ? { op: "back" } : { op: "replace", hash: "" };
}
